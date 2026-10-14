import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export interface DesignSection {
  name: string;
  purpose: string;
}

export interface CampaignDesign {
  title: string;
  audience: string;
  summary: string;
  palette: {
    background: string;
    text: string;
    accent: string;
  };
  sections: DesignSection[];
}

export interface DeploymentInfo {
  id: string;
  url: string;
  projectId: string;
  readyState: string;
  deployedAt: string;
}

export interface SignupStore {
  storeId: string;
  token: string;
}

export interface Campaign {
  slug: string;
  brief: string;
  agentId?: string;
  design?: CampaignDesign;
  deployment?: DeploymentInfo;
  signups?: SignupStore;
  createdAt: string;
  updatedAt: string;
}

export function normalizeSlug(input: string): string {
  const slug = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 52) {
    throw new Error(
      "slug must be kebab-case and 52 characters or fewer, for example beanline or northwind-launch",
    );
  }
  return slug;
}

export function campaignPaths(root: string, slug: string) {
  const safe = normalizeSlug(slug);
  const dir = path.resolve(root, "campaigns", safe);
  const campaigns = path.resolve(root, "campaigns");
  if (dir !== campaigns && !dir.startsWith(campaigns + path.sep)) {
    throw new Error("Invalid campaign slug");
  }
  return {
    slug: safe,
    dir,
    siteDir: path.join(dir, "site"),
    designPath: path.join(dir, "design.md"),
    statePath: path.join(dir, "campaign.json"),
    statsPath: path.join(dir, "latest-stats.json"),
    reportsDir: path.join(dir, "reports"),
    relativeSiteDir: path.posix.join("campaigns", safe, "site"),
    relativeDesignPath: path.posix.join("campaigns", safe, "design.md"),
  };
}

export async function loadCampaign(root: string, slug: string): Promise<Campaign | undefined> {
  const { statePath } = campaignPaths(root, slug);
  try {
    const raw = await readFile(statePath, "utf8");
    return JSON.parse(raw) as Campaign;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
}

export async function saveCampaign(root: string, campaign: Campaign): Promise<void> {
  const paths = campaignPaths(root, campaign.slug);
  await mkdir(paths.dir, { recursive: true });
  const tmp = `${paths.statePath}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(campaign, null, 2) + "\n");
  await rename(tmp, paths.statePath);
}

export async function listCampaigns(root: string): Promise<Campaign[]> {
  let names: string[];
  try {
    names = await readdir(path.join(root, "campaigns"));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const campaigns: Campaign[] = [];
  for (const name of names) {
    const campaign = await loadCampaign(root, name).catch(() => undefined);
    if (campaign) campaigns.push(campaign);
  }
  campaigns.sort((a, b) => a.slug.localeCompare(b.slug));
  return campaigns;
}

export function renderDesign(campaign: Campaign): string {
  const design = campaign.design;
  if (!design) return "";
  const sections = design.sections
    .map((section) => `### ${section.name}\n\n${section.purpose}`)
    .join("\n\n");
  return `# ${design.title}

Audience: ${design.audience}

${design.summary}

## Palette

- background: ${design.palette.background}
- text: ${design.palette.text}
- accent: ${design.palette.accent}

## Sections

${sections}

## Brief

${campaign.brief}
`;
}
