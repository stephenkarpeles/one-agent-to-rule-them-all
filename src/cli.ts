import path from "node:path";
import { fileURLToPath } from "node:url";
import { listCampaigns, loadCampaign, saveCampaign } from "./campaign.js";
import { assertNodeVersion, loadEnv } from "./env.js";
import { launchPrompt, reportPrompt } from "./prompt.js";
import { runCampaignAgent } from "./run.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

assertNodeVersion();
loadEnv(root);

const [command, ...rest] = process.argv.slice(2);

const exitCode = await main(command, rest);
process.exit(exitCode);

async function main(command: string | undefined, args: string[]): Promise<number> {
  if (command === "launch") {
    const brief = args.join(" ").trim();
    if (!brief) {
      console.error("Pass a brief.\n\nExample:\n  npm run agent -- launch \"Landing page for a coffee subscription called Beanline\"");
      return 1;
    }
    return runCampaignAgent({
      root,
      name: "campaign-launch",
      prompt: launchPrompt(brief),
    });
  }

  if (command === "report") {
    const slug = args[0]?.trim();
    if (!slug) {
      console.error("Pass a campaign slug.\n\nExample:\n  npm run agent -- report beanline");
      return 1;
    }
    const campaign = await loadCampaign(root, slug);
    if (!campaign) {
      console.error(`No campaign "${slug}". Launch one first.`);
      return 1;
    }
    if (!campaign.deployment?.projectId) {
      console.error(`Campaign "${campaign.slug}" is not deployed yet.`);
      return 1;
    }
    return runCampaignAgent({
      root,
      name: `report-${campaign.slug}`,
      resumeId: campaign.agentId,
      prompt: reportPrompt(campaign),
      onAgentId(agentId) {
        if (campaign.agentId === agentId) return;
        void saveCampaign(root, { ...campaign, agentId, updatedAt: new Date().toISOString() }).catch((err: unknown) => {
          console.error(err instanceof Error ? err.message : err);
        });
      },
    });
  }

  if (command === "list") {
    const campaigns = await listCampaigns(root);
    if (campaigns.length === 0) {
      console.log("No campaigns yet.");
      return 0;
    }
    for (const campaign of campaigns) {
      const title = campaign.design?.title ?? campaign.slug;
      const url = campaign.deployment?.url ?? "not deployed";
      console.log(`${campaign.slug}\t${title}\t${url}`);
    }
    return 0;
  }

  console.error(`Usage:
  npm run agent -- launch "<brief>"
  npm run agent -- report <slug>
  npm run agent -- list`);
  return 1;
}
