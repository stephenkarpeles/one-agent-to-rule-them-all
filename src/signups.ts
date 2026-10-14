import type { SignupStore } from "./campaign.js";
import { teamQuery, vercelToken } from "./env.js";
import type { SignupRecord, SignupSnapshot } from "./report.js";

export type { SignupRecord, SignupSnapshot };

const SIGNUP_MARKER = "data-signup-recorder";

const SIGNUP_SCRIPT = `
document.addEventListener("submit", (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  const input = form.querySelector('input[type="email"]');
  if (!(input instanceof HTMLInputElement)) return;
  event.preventDefault();
  const button = form.querySelector("button");
  if (button instanceof HTMLButtonElement) button.disabled = true;
  const email = input.value.trim();
  fetch("/api/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ email }),
  })
    .then(async (response) => {
      const body = await response.json().catch(() => ({}));
      const message = response.ok
        ? body.alreadyJoined
          ? "You're already on the list."
          : "You're on the list."
        : body.error || "Could not save that address. Try again.";
      showStatus(form, message);
    })
    .catch(() => {
      showStatus(form, "Could not save that address. Try again.");
    })
    .finally(() => {
      if (button instanceof HTMLButtonElement) button.disabled = false;
    });
});

function showStatus(form, message) {
  let status = form.nextElementSibling;
  if (!status || !status.classList.contains("form-status")) {
    status = document.createElement("p");
    status.className = "form-status";
    status.style.margin = "0.75rem 0 0";
    form.insertAdjacentElement("afterend", status);
  }
  status.textContent = message;
}
`.trim();

export function injectSignupRecorder(html: string): string {
  if (html.includes(SIGNUP_MARKER)) return html;
  const tag = `<script ${SIGNUP_MARKER}>\n${SIGNUP_SCRIPT}\n</script>\n`;
  if (html.includes("</body>")) return html.replace("</body>", `${tag}</body>`);
  return `${html}\n${tag}`;
}

export function signupOutputFiles(token: string): Array<{ file: string; data: string; encoding: "base64" }> {
  const config = JSON.stringify({ version: 3 });
  const vcConfig = JSON.stringify({
    runtime: "nodejs22.x",
    handler: "index.js",
    launcherType: "Nodejs",
    shouldAddHelpers: true,
    maxDuration: 10,
    environment: { BLOB_READ_WRITE_TOKEN: token },
  });
  return [
    encodedFile("config.json", config),
    encodedFile("functions/api/subscribe.func/.vc-config.json", vcConfig),
    encodedFile("functions/api/subscribe.func/index.js", subscribeSource()),
  ];
}

export async function ensureProject(name: string, existingId?: string): Promise<string> {
  if (existingId) return existingId;
  const found = await api(`/v9/projects/${encodeURIComponent(name)}`);
  if (found.status >= 200 && found.status < 300 && isRecord(found.body) && typeof found.body.id === "string") {
    return found.body.id;
  }
  if (found.status !== 404) {
    throw new Error(messageFrom(found.body, "Could not find the Vercel project."));
  }
  const created = await api("/v11/projects", {
    method: "POST",
    body: JSON.stringify({ name, framework: null }),
  });
  if (isRecord(created.body) && typeof created.body.id === "string") return created.body.id;
  throw new Error(messageFrom(created.body, "Could not create the Vercel project."));
}

export async function ensureSignupStore(
  projectId: string,
  slug: string,
  existing?: SignupStore,
): Promise<SignupStore> {
  if (existing?.token) {
    await assertToken(existing.token);
    return existing;
  }

  const storeId = await findOrCreateStore(`${slug}-signups`);
  await connectStore(storeId, projectId);
  const token = await readBlobToken(projectId);
  await assertToken(token);
  return { storeId, token };
}

export async function loadSignupSnapshot(token: string | undefined): Promise<SignupSnapshot> {
  const fetchedAt = new Date().toISOString();
  if (!token) {
    return {
      available: false,
      reason: "This campaign is not saving email addresses yet. Deploy the site again to start the waitlist.",
      count: 0,
      signups: [],
      fetchedAt,
    };
  }
  try {
    const signups = await readSignups(token);
    return { available: true, count: signups.length, signups, fetchedAt };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { available: false, reason, count: 0, signups: [], fetchedAt };
  }
}

async function readSignups(token: string): Promise<SignupRecord[]> {
  const listed = await listSignupBlobs(token);
  const records: SignupRecord[] = [];
  for (const blob of listed) {
    const response = await fetch(blob.url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) continue;
    const body = (await response.json()) as { email?: unknown; signedUpAt?: unknown };
    if (typeof body.email !== "string" || typeof body.signedUpAt !== "string") continue;
    records.push({ email: body.email, signedUpAt: body.signedUpAt });
  }
  records.sort((a, b) => b.signedUpAt.localeCompare(a.signedUpAt));
  return records;
}

async function listSignupBlobs(token: string): Promise<Array<{ url: string; pathname: string }>> {
  const blobs: Array<{ url: string; pathname: string }> = [];
  let cursor: string | undefined;
  do {
    const url = new URL("https://vercel.com/api/blob/");
    url.searchParams.set("prefix", "signups/");
    url.searchParams.set("limit", "1000");
    if (cursor) url.searchParams.set("cursor", cursor);
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        "x-api-version": "12",
      },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
      throw new Error(await blobError(response, "Could not read the waitlist."));
    }
    const body = (await response.json()) as {
      blobs?: Array<{ url?: string; pathname?: string }>;
      cursor?: string;
      hasMore?: boolean;
    };
    for (const blob of body.blobs ?? []) {
      if (blob.url && blob.pathname) blobs.push({ url: blob.url, pathname: blob.pathname });
    }
    cursor = body.hasMore ? body.cursor : undefined;
  } while (cursor);
  return blobs;
}

async function assertToken(token: string): Promise<void> {
  const url = new URL("https://vercel.com/api/blob/");
  url.searchParams.set("prefix", "signups/");
  url.searchParams.set("limit", "1");
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "x-api-version": "12",
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    throw new Error(await blobError(response, "Waitlist storage rejected the token."));
  }
}

async function findOrCreateStore(name: string): Promise<string> {
  const created = await api("/v1/storage/stores/blob", {
    method: "POST",
    body: JSON.stringify({ name, region: "iad1", access: "private" }),
  });
  if (created.status >= 200 && created.status < 300) return storeIdFrom(created.body);

  const listed = await api("/v1/storage/stores");
  const stores = storesFrom(listed.body);
  const found = stores.find((store) => store.name === name);
  if (found) return found.id;
  throw new Error(messageFrom(created.body, "Could not create waitlist storage."));
}

async function connectStore(storeId: string, projectId: string): Promise<void> {
  const result = await api(`/v1/storage/stores/${storeId}/connections`, {
    method: "POST",
    body: JSON.stringify({
      projectId,
      envVarEnvironments: ["production"],
      type: "integration",
    }),
  });
  if (result.status >= 200 && result.status < 300) return;
  if (result.status === 409) return;
  const text = messageFrom(result.body, "");
  if (/already|exist|connected/i.test(text)) return;
  throw new Error(text || "Could not connect waitlist storage to the site.");
}

async function readBlobToken(projectId: string): Promise<string> {
  for (let attempt = 0; attempt < 6; attempt++) {
    const listed = await api(`/v9/projects/${projectId}/env?${new URLSearchParams(teamQuery())}`);
    const found = envsFrom(listed.body).find((item) => item.key === "BLOB_READ_WRITE_TOKEN");
    if (found?.id) {
      const params = new URLSearchParams({ decrypt: "true", ...teamQuery() });
      const one = await api(`/v9/projects/${projectId}/env/${found.id}?${params}`);
      const value = isRecord(one.body) && typeof one.body.value === "string" ? one.body.value.trim() : "";
      if (value.startsWith("vercel_blob_rw_")) return value;
    }
    await delay(1000);
  }
  throw new Error("Vercel did not provide a token for the waitlist store.");
}

async function api(pathname: string, init?: RequestInit): Promise<{ status: number; body: unknown }> {
  const token = vercelToken();
  if (!token) {
    throw new Error("VERCEL_TOKEN is not set. Add a token from https://vercel.com/account/tokens to .env and run again.");
  }
  const url = pathname.includes("?")
    ? `https://api.vercel.com${pathname}`
    : `https://api.vercel.com${pathname}${queryString()}`;
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
    signal: AbortSignal.timeout(60_000),
  });
  const text = await response.text();
  if (!text) return { status: response.status, body: null };
  try {
    return { status: response.status, body: JSON.parse(text) as unknown };
  } catch {
    return { status: response.status, body: text };
  }
}

function queryString(): string {
  const params = new URLSearchParams(teamQuery());
  const query = params.toString();
  return query ? `?${query}` : "";
}

function subscribeSource(): string {
  return `const { createHash } = require("node:crypto");

module.exports = async function subscribe(req, res) {
  try {
    if (req.method !== "POST") {
      send(res, 405, { error: "Send the email address with POST." });
      return;
    }
    const email = await readEmail(req);
    if (!email) {
      send(res, 400, { error: "Enter a valid email address." });
      return;
    }
    const token = process.env.BLOB_READ_WRITE_TOKEN;
    if (!token) {
      send(res, 500, { error: "Signup storage is not configured." });
      return;
    }
    const pathname = "signups/" + createHash("sha256").update(email).digest("hex") + ".json";
    const existing = await readSignup(token, pathname);
    if (existing) {
      send(res, 200, { ok: true, alreadyJoined: true });
      return;
    }
    await writeSignup(token, pathname, { email: email, signedUpAt: new Date().toISOString() });
    send(res, 200, { ok: true, alreadyJoined: false });
  } catch (err) {
    send(res, 500, { error: "Could not save that address. Try again." });
  }
};

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

async function readEmail(req) {
  let raw = "";
  if (req.body && typeof req.body === "object") {
    return normalize(req.body.email);
  }
  if (typeof req.body === "string") raw = req.body;
  else raw = await readStream(req);
  const type = String(req.headers["content-type"] || "");
  if (type.includes("application/json")) {
    try {
      return normalize(JSON.parse(raw).email);
    } catch (err) {
      return null;
    }
  }
  return normalize(new URLSearchParams(raw).get("email"));
}

function normalize(value) {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email)) return null;
  return email;
}

function readStream(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function storeHost(token) {
  const storeId = String(token).split("_")[3];
  if (!storeId) throw new Error("missing store");
  return storeId.toLowerCase();
}

async function readSignup(token, pathname) {
  const response = await fetch("https://" + storeHost(token) + ".private.blob.vercel-storage.com/" + pathname, {
    headers: { Authorization: "Bearer " + token },
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("read failed");
  return response.json();
}

async function writeSignup(token, pathname, record) {
  const url = new URL("https://vercel.com/api/blob/");
  url.searchParams.set("pathname", pathname);
  const response = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: "Bearer " + token,
      "x-api-version": "12",
      "x-vercel-blob-access": "private",
      "x-content-type": "application/json",
      "x-add-random-suffix": "0",
    },
    body: JSON.stringify(record),
  });
  if (!response.ok) throw new Error("write failed");
}
`;
}

function encodedFile(file: string, text: string): { file: string; data: string; encoding: "base64" } {
  return { file, data: Buffer.from(text).toString("base64"), encoding: "base64" };
}

function storeIdFrom(body: unknown): string {
  if (isRecord(body) && isRecord(body.store) && typeof body.store.id === "string") return body.store.id;
  if (isRecord(body) && typeof body.id === "string") return body.id;
  throw new Error("Vercel did not return a waitlist store id.");
}

function storesFrom(body: unknown): Array<{ id: string; name: string }> {
  const list = Array.isArray(body) ? body : isRecord(body) && Array.isArray(body.stores) ? body.stores : [];
  return list.flatMap((item) => {
    if (!isRecord(item) || typeof item.id !== "string") return [];
    const name = typeof item.name === "string" ? item.name : "";
    return [{ id: item.id, name }];
  });
}

function envsFrom(body: unknown): Array<{ id?: string; key?: string; value?: string }> {
  if (!isRecord(body) || !Array.isArray(body.envs)) return [];
  return body.envs.flatMap((item) => (isRecord(item) ? [item as { id?: string; key?: string; value?: string }] : []));
}

function messageFrom(body: unknown, fallback: string): string {
  if (typeof body === "string" && body.trim()) return body.slice(0, 500);
  if (!isRecord(body)) return fallback;
  if (typeof body.message === "string") return body.message;
  if (typeof body.error === "string") return body.error;
  if (isRecord(body.error) && typeof body.error.message === "string") return body.error.message;
  return fallback;
}

async function blobError(response: Response, fallback: string): Promise<string> {
  const text = await response.text();
  if (!text) return `${fallback} (HTTP ${response.status})`;
  try {
    return messageFrom(JSON.parse(text) as unknown, `${fallback} (HTTP ${response.status})`);
  } catch {
    return text.slice(0, 300);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
