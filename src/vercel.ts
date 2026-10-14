import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { teamQuery, vercelToken } from "./env.js";
import type { MetricRow, TrafficSnapshot } from "./report.js";

const INSIGHTS_SNIPPET = '<script defer src="/_vercel/insights/script.js"></script>';

export class VercelRequestError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "VercelRequestError";
    this.status = status;
  }
}

export function requireVercelToken(): string {
  const token = vercelToken();
  if (!token) {
    throw new VercelRequestError(
      401,
      "VERCEL_TOKEN is not set. Add a token from https://vercel.com/account/tokens to .env and run again.",
    );
  }
  return token;
}

export function injectInsights(html: string): string {
  if (html.includes("/_vercel/insights/script.js")) return html;
  if (html.includes("</body>")) {
    return html.replace("</body>", `${INSIGHTS_SNIPPET}\n</body>`);
  }
  return `${html}\n${INSIGHTS_SNIPPET}\n`;
}

export async function readSiteFiles(
  siteDir: string,
): Promise<Array<{ file: string; data: string; encoding: "base64" }>> {
  const files: Array<{ file: string; data: string; encoding: "base64" }> = [];

  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === ".DS_Store" || entry.name === "node_modules" || entry.name.startsWith(".")) {
        continue;
      }
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }
      if (!entry.isFile()) continue;

      const rel = path.relative(siteDir, full).split(path.sep).join("/");
      let body = await readFile(full);
      if (rel.endsWith(".html") || rel.endsWith(".htm")) {
        const html = injectInsights(body.toString("utf8"));
        await writeFile(full, html);
        body = Buffer.from(html);
      }
      if (body.length > 1_000_000) {
        throw new Error(`${rel} is over 1MB. Keep the site to a few small static files.`);
      }
      files.push({ file: rel, data: body.toString("base64"), encoding: "base64" });
    }
  }

  await walk(siteDir);
  const encodedBytes = files.reduce((total, file) => total + file.data.length, 0);
  if (encodedBytes > 8_000_000) {
    throw new Error("The site is too large to deploy inline. Remove extra assets and try again.");
  }
  return files;
}

export interface LiveDeployment {
  id: string;
  url: string;
  projectId: string;
  readyState: string;
}

export async function deployDirectory(siteDir: string, projectName: string): Promise<LiveDeployment> {
  const token = requireVercelToken();
  const files = await readSiteFiles(siteDir).catch((err: unknown) => {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error("The site directory does not exist yet. Write index.html, then deploy.");
    }
    throw err;
  });
  if (files.length === 0) {
    throw new Error(`No files in ${siteDir}. Write index.html before deploying.`);
  }
  if (!files.some((file) => file.file === "index.html")) {
    throw new Error("The site needs index.html at the root of the site directory.");
  }

  const params = new URLSearchParams({
    forceNew: "1",
    skipAutoDetectionConfirmation: "1",
    ...teamQuery(),
  });
  const created = await vercelJson<{
    id?: string;
    url?: string;
    readyState?: string;
    projectId?: string;
    alias?: string[];
    errorMessage?: string;
  }>(token, `/v13/deployments?${params}`, {
    method: "POST",
    body: JSON.stringify({
      name: projectName,
      project: projectName,
      target: "production",
      files,
      projectSettings: { framework: null },
    }),
  });

  if (!created.id) throw new Error("Vercel did not return a deployment id.");
  const ready = await waitUntilReady(token, created.id, created);
  const projectId = ready.projectId ?? created.projectId;
  if (!projectId) throw new Error("Vercel did not return a project id, so traffic cannot be queried later.");

  return {
    id: ready.id ?? created.id,
    url: publicUrl(ready.url ? ready : created),
    projectId,
    readyState: ready.readyState ?? "UNKNOWN",
  };
}

export async function fetchTraffic(input: {
  projectId: string;
  url?: string;
  since: string;
  until: string;
}): Promise<TrafficSnapshot> {
  const token = requireVercelToken();
  const base = {
    projectId: input.projectId,
    since: input.since,
    until: input.until,
    ...teamQuery(),
  };

  const totals = await analyticsGet(token, "/v1/query/web-analytics/visits/count", base);
  if (!totals.ok) {
    if (totals.status === 401) throw new VercelRequestError(totals.status, totals.message);
    return emptySnapshot(input, totals.message);
  }

  const [byDay, byCountry, byDevice, byReferrer, byCampaign, byPath] = await Promise.all([
    breakdown(token, base, "day"),
    breakdown(token, base, "country"),
    breakdown(token, base, "deviceType"),
    breakdown(token, base, "referrerHostname"),
    breakdown(token, base, "utmSource"),
    breakdown(token, base, "requestPath"),
  ]);

  const data = isRecord(totals.data) && isRecord(totals.data.data) ? totals.data.data : {};
  return {
    available: true,
    since: input.since,
    until: input.until,
    pageviews: numberOrNull(data.pageviews),
    visitors: numberOrNull(data.visitors),
    byDay,
    byCountry,
    byDevice,
    byReferrer,
    byCampaign,
    byPath,
    projectId: input.projectId,
    url: input.url,
    fetchedAt: new Date().toISOString(),
  };
}

function emptySnapshot(
  input: { since: string; until: string; projectId: string; url?: string },
  reason: string,
): TrafficSnapshot {
  return {
    available: false,
    reason,
    since: input.since,
    until: input.until,
    pageviews: null,
    visitors: null,
    byDay: [],
    byCountry: [],
    byDevice: [],
    byReferrer: [],
    byCampaign: [],
    byPath: [],
    projectId: input.projectId,
    url: input.url,
    fetchedAt: new Date().toISOString(),
  };
}

async function breakdown(
  token: string,
  base: Record<string, string>,
  dimension: string,
): Promise<MetricRow[]> {
  const result = await analyticsGet(token, "/v1/query/web-analytics/visits/aggregate", {
    ...base,
    by: dimension,
    limit: dimension === "day" ? "31" : "5",
  });
  if (!result.ok) return [];
  const data = isRecord(result.data) ? result.data.data : undefined;
  if (!Array.isArray(data)) return [];
  return data.map((row) => toMetricRow(row, dimension));
}

function toMetricRow(row: unknown, dimension: string): MetricRow {
  if (!isRecord(row)) return { label: "unknown", pageviews: 0, visitors: 0 };
  const labelKey = dimension === "day" ? "timestamp" : dimension;
  const rawLabel = row[labelKey];
  const label = typeof rawLabel === "string" && rawLabel ? rawLabel : "unknown";
  return {
    label: dimension === "day" ? label.slice(0, 10) : label,
    pageviews: typeof row.pageviews === "number" ? row.pageviews : 0,
    visitors: typeof row.visitors === "number" ? row.visitors : 0,
  };
}

async function waitUntilReady(
  token: string,
  id: string,
  initial: { id?: string; url?: string; readyState?: string; projectId?: string; alias?: string[]; errorMessage?: string },
): Promise<typeof initial> {
  let current = initial;
  for (let attempt = 0; attempt < 30; attempt++) {
    if (current.readyState === "READY") return current;
    if (current.readyState === "ERROR" || current.readyState === "CANCELED") {
      throw new Error(current.errorMessage || `Deployment ${id} ended as ${current.readyState}.`);
    }
    await delay(2000);
    const params = new URLSearchParams(teamQuery());
    const query = params.size ? `?${params}` : "";
    current = await vercelJson(token, `/v13/deployments/${id}${query}`);
  }
  return current;
}

function publicUrl(deployment: { url?: string; alias?: string[] }): string {
  const host = deployment.alias?.find((alias) => alias.length > 0) || deployment.url;
  if (!host) throw new Error("Vercel did not return a deployment URL.");
  return host.startsWith("http") ? host : `https://${host}`;
}

type AnalyticsResult =
  | { ok: true; data: unknown }
  | { ok: false; status: number; message: string };

async function analyticsGet(
  token: string,
  pathname: string,
  params: Record<string, string>,
): Promise<AnalyticsResult> {
  const url = new URL(`https://api.vercel.com${pathname}`);
  for (const [key, value] of Object.entries(params)) {
    if (value) url.searchParams.set(key, value);
  }
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30_000),
  });
  if (response.ok) return { ok: true, data: await response.json() };
  return { ok: false, status: response.status, message: await readError(response) };
}

async function vercelJson<T>(token: string, pathname: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`https://api.vercel.com${pathname}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) {
    throw new VercelRequestError(response.status, await readError(response));
  }
  return (await response.json()) as T;
}

async function readError(response: Response): Promise<string> {
  const text = await response.text();
  try {
    const body = JSON.parse(text) as { error?: { message?: string } | string; message?: string };
    if (typeof body.error === "string") return body.error;
    if (body.error?.message) return body.error.message;
    if (body.message) return body.message;
  } catch {
    // The body was not JSON.
  }
  return text.slice(0, 500) || `Vercel returned HTTP ${response.status}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
