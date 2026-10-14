import type { SDKCustomTool, SDKCustomToolResult, SDKJsonValue } from "@cursor/sdk";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  campaignPaths,
  loadCampaign,
  renderDesign,
  saveCampaign,
  type Campaign,
  type CampaignDesign,
} from "./campaign.js";
import { renderReport, type TrafficSnapshot } from "./report.js";
import { ensureProject, ensureSignupStore, loadSignupSnapshot, type SignupSnapshot } from "./signups.js";
import { deployDirectory, fetchTraffic, VercelRequestError } from "./vercel.js";

interface ToolHost {
  agentId: string;
}

export function createTools(root: string, host: ToolHost): Record<string, SDKCustomTool> {
  return {
    record_design: {
      description:
        "Save the landing-page design and open the campaign folder. Call this before writing any site files. Returns the site directory the next step must fill.",
      annotations: { title: "Record design", idempotentHint: true },
      inputSchema: schema({
        type: "object",
        properties: {
          slug: {
            type: "string",
            description: "Short kebab-case name, used as the folder and the Vercel project name.",
          },
          brief: { type: "string", description: "The user's brief, unchanged." },
          title: { type: "string" },
          audience: { type: "string" },
          summary: {
            type: "string",
            description: "What the page is and the single action it asks for.",
          },
          palette: {
            type: "object",
            properties: {
              background: { type: "string" },
              text: { type: "string" },
              accent: { type: "string" },
            },
            required: ["background", "text", "accent"],
          },
          sections: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                purpose: { type: "string" },
              },
              required: ["name", "purpose"],
            },
          },
        },
        required: ["slug", "brief", "title", "audience", "summary", "palette", "sections"],
      }),
      async execute(args) {
        return run(() => recordDesign(root, host, args));
      },
    },
    deploy_site: {
      description:
        "Deploy the campaign's static site to Vercel production. Call this only after index.html exists in the site directory. Returns the live URL and project id.",
      annotations: { title: "Deploy site", openWorldHint: true },
      inputSchema: schema({
        type: "object",
        properties: { slug: { type: "string" } },
        required: ["slug"],
      }),
      async execute(args) {
        return run(() => deploySite(root, args));
      },
    },
    fetch_traffic: {
      description:
        "Read Vercel Web Analytics and the waitlist for a deployed campaign. Returns page views, visitors, breakdowns, and the email addresses people submitted. A new site may legitimately be all zeros. Do not invent numbers when this fails.",
      annotations: { title: "Fetch traffic", readOnlyHint: true, openWorldHint: true },
      inputSchema: schema({
        type: "object",
        properties: { slug: { type: "string" } },
        required: ["slug"],
      }),
      async execute(args) {
        return run(() => pullTraffic(root, args));
      },
    },
    write_marketing_report: {
      description:
        "Write the marketing report for a campaign. Pass a narrative that interprets fetch_traffic, including how many people joined the waitlist. The tool attaches the measured stats and the saved email addresses itself, then saves a markdown file and posts it to MARKETING_WEBHOOK_URL when that is set.",
      annotations: { title: "Write marketing report", openWorldHint: true },
      inputSchema: schema({
        type: "object",
        properties: {
          slug: { type: "string" },
          narrative: {
            type: "string",
            description:
              "What shipped, what the measured numbers mean, and one next action. Do not invent metrics.",
          },
        },
        required: ["slug", "narrative"],
      }),
      async execute(args) {
        return run(() => writeReport(root, args));
      },
    },
  };
}

async function recordDesign(
  root: string,
  host: ToolHost,
  args: Record<string, SDKJsonValue>,
): Promise<unknown> {
  const paths = campaignPaths(root, requiredString(args, "slug"));
  const design: CampaignDesign = {
    title: requiredString(args, "title"),
    audience: requiredString(args, "audience"),
    summary: requiredString(args, "summary"),
    palette: readPalette(args.palette),
    sections: readSections(args.sections),
  };
  const existing = await loadCampaign(root, paths.slug);
  const now = new Date().toISOString();
  const campaign: Campaign = {
    slug: paths.slug,
    brief: requiredString(args, "brief"),
    agentId: host.agentId || existing?.agentId,
    design,
    deployment: existing?.deployment,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  await mkdir(paths.siteDir, { recursive: true });
  await writeFile(paths.designPath, renderDesign(campaign));
  await saveCampaign(root, campaign);
  return {
    slug: campaign.slug,
    siteDir: paths.relativeSiteDir,
    designPath: paths.relativeDesignPath,
    next: `Write a static index.html and styles.css in ${paths.relativeSiteDir}, using this design. Then call deploy_site with slug "${campaign.slug}".`,
  };
}

async function deploySite(root: string, args: Record<string, SDKJsonValue>): Promise<unknown> {
  const paths = campaignPaths(root, requiredString(args, "slug"));
  const campaign = await requireCampaign(root, paths.slug);
  const projectId = await ensureProject(paths.slug, campaign.deployment?.projectId);
  const signups = await ensureSignupStore(projectId, paths.slug, campaign.signups);
  campaign.signups = signups;
  campaign.updatedAt = new Date().toISOString();
  await saveCampaign(root, campaign);
  const deployment = await deployDirectory(paths.siteDir, paths.slug, signups.token);
  campaign.deployment = { ...deployment, deployedAt: new Date().toISOString() };
  campaign.updatedAt = campaign.deployment.deployedAt;
  await saveCampaign(root, campaign);

  if (deployment.readyState !== "READY") {
    return {
      slug: campaign.slug,
      url: deployment.url,
      projectId: deployment.projectId,
      readyState: deployment.readyState,
      next: "The deployment is not READY yet. Stop and give the user this URL. Do not fetch traffic or write a report.",
    };
  }

  return {
    slug: campaign.slug,
    url: deployment.url,
    deploymentId: deployment.id,
    projectId: deployment.projectId,
    readyState: deployment.readyState,
    next: `Call fetch_traffic with slug "${campaign.slug}".`,
  };
}

async function pullTraffic(root: string, args: Record<string, SDKJsonValue>): Promise<unknown> {
  const slug = requiredString(args, "slug");
  const snapshot = await loadTraffic(root, slug);
  const signups = await loadSignups(root, slug);
  return {
    ...snapshot,
    signups,
    next: "Call write_marketing_report with this slug and a narrative for the marketing owner. Use only numbers present in this result, including the waitlist count.",
  };
}

async function writeReport(root: string, args: Record<string, SDKJsonValue>): Promise<unknown> {
  const slug = requiredString(args, "slug");
  const narrative = requiredString(args, "narrative");
  if (narrative.length > 20_000) throw new Error("narrative is too long. Keep it under 20,000 characters.");

  const paths = campaignPaths(root, slug);
  const campaign = await requireCampaign(root, slug);
  const traffic = await loadTraffic(root, slug);
  const signups = await loadSignups(root, slug);
  const preparedAt = new Date();
  const markdown = renderReport({
    title: campaign.design?.title ?? campaign.slug,
    url: campaign.deployment?.url,
    narrative,
    traffic,
    signups,
    preparedAt,
  });
  await mkdir(paths.reportsDir, { recursive: true });
  const stamp = preparedAt.toISOString().replace(/[:.]/g, "-");
  const reportPath = path.join(paths.reportsDir, `${stamp}.md`);
  await writeFile(reportPath, markdown);

  const webhook = await postWebhook(markdown);
  const relativeReport = path.posix.join("campaigns", paths.slug, "reports", `${stamp}.md`);
  return {
    slug: campaign.slug,
    reportPath: relativeReport,
    url: campaign.deployment?.url,
    webhook,
    next: "Stop. Tell the user the live URL and this report path.",
  };
}

async function loadTraffic(root: string, slug: string): Promise<TrafficSnapshot> {
  const paths = campaignPaths(root, slug);
  const campaign = await requireCampaign(root, slug);
  if (!campaign.deployment?.projectId) {
    throw new Error(`Campaign "${paths.slug}" has no deployment yet. Call deploy_site first.`);
  }
  const since = utcDay(campaign.deployment.deployedAt);
  const until = utcDay(new Date().toISOString());
  const snapshot = await fetchTraffic({
    projectId: campaign.deployment.projectId,
    url: campaign.deployment.url,
    since: since > until ? until : since,
    until,
  });
  await writeFile(paths.statsPath, JSON.stringify(snapshot, null, 2) + "\n");
  return snapshot;
}

async function loadSignups(root: string, slug: string): Promise<SignupSnapshot> {
  const paths = campaignPaths(root, slug);
  const campaign = await requireCampaign(root, slug);
  const snapshot = await loadSignupSnapshot(campaign.signups?.token);
  await writeFile(path.join(paths.dir, "latest-signups.json"), JSON.stringify(snapshot, null, 2) + "\n");
  return snapshot;
}

async function requireCampaign(root: string, slug: string): Promise<Campaign> {
  const campaign = await loadCampaign(root, slug);
  if (!campaign) {
    throw new Error(`No campaign named "${normalizeSafe(slug)}". Call record_design first.`);
  }
  return campaign;
}

function normalizeSafe(slug: string): string {
  try {
    return campaignPaths(process.cwd(), slug).slug;
  } catch {
    return slug;
  }
}

async function postWebhook(markdown: string): Promise<string> {
  const url = process.env.MARKETING_WEBHOOK_URL;
  if (!url) return "not configured";
  const text = markdown.length > 35_000 ? `${markdown.slice(0, 35_000)}\n\n[truncated]` : markdown;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) return `delivery failed: HTTP ${response.status}`;
  return "delivered";
}

function utcDay(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return new Date().toISOString().slice(0, 10);
  return date.toISOString().slice(0, 10);
}

function readPalette(value: SDKJsonValue | undefined): CampaignDesign["palette"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("palette must be an object with background, text, and accent");
  }
  return {
    background: requiredString(value, "background"),
    text: requiredString(value, "text"),
    accent: requiredString(value, "accent"),
  };
}

function readSections(value: SDKJsonValue | undefined): CampaignDesign["sections"] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("sections must be a non-empty array");
  }
  return value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`sections[${index}] must be an object`);
    }
    const name = item.name;
    const purpose = item.purpose;
    if (typeof name !== "string" || !name.trim() || typeof purpose !== "string" || !purpose.trim()) {
      throw new Error(`sections[${index}] needs a name and a purpose`);
    }
    return { name: name.trim(), purpose: purpose.trim() };
  });
}

function requiredString(args: Record<string, SDKJsonValue>, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${key} must be a non-empty string`);
  }
  return value.trim();
}

async function run(fn: () => Promise<unknown>): Promise<SDKCustomToolResult> {
  try {
    return JSON.stringify(await fn(), null, 2);
  } catch (err) {
    const message = err instanceof VercelRequestError || err instanceof Error ? err.message : String(err);
    return { content: [{ type: "text", text: message }], isError: true };
  }
}

function schema(value: Record<string, SDKJsonValue>): Record<string, SDKJsonValue> {
  return value;
}
