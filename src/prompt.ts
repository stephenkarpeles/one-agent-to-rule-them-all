import type { Campaign } from "./campaign.js";

export function launchPrompt(brief: string): string {
  return `You are running one campaign from design through a marketing report. Deploy, traffic, and the report happen only through your tools. Do the steps in order. Every tool result has a "next" field. Follow it. Use the same slug at every step.

The person you are reporting to is the marketing owner who sent this brief.

Brief:
"""
${brief}
"""

Steps:
1. Call record_design. Choose a short kebab-case slug from the brand or product name. The design has to be specific enough to build: title, audience, a one-paragraph summary, a three-color palette, and the sections of a single landing page. Pass the brief through unchanged.
2. Build a static site in the siteDir that tool returns. Use index.html and styles.css. Match the palette and cover every section. Write real copy for this brief. Make the page responsive. If the page asks for an email address, use a normal email form. Deploy saves those addresses. Do not add a framework, a package.json, a build step, or your own server. Do not add the Vercel analytics script; deploy adds it.
3. Call deploy_site with the slug. If the tool returns an error, stop and tell the user that error. Do not invent a URL.
4. Call fetch_traffic with the slug. A brand-new site can have zero page views and zero signups. Keep zeros. Do not invent metrics.
5. Call write_marketing_report with the slug and a narrative for the marketing owner: what shipped, what the visit counts and the waitlist mean, and one next action. Only mention numbers that fetch_traffic returned.

When you finish, reply with the live URL and the report path.`;
}

export function reportPrompt(campaign: Campaign): string {
  const title = campaign.design?.title ?? campaign.slug;
  const url = campaign.deployment?.url ?? "unknown";
  return `Check in on an existing campaign and report to the marketing owner. Do not redesign the page and do not redeploy.

Campaign slug: ${campaign.slug}
Title: ${title}
Live URL: ${url}
Project: ${campaign.deployment?.projectId ?? "unknown"}

1. Call fetch_traffic with slug "${campaign.slug}".
2. Call write_marketing_report with that slug and a narrative that interprets the visit counts and the waitlist for marketing and names one next action. Do not invent metrics or email addresses. If traffic or the waitlist is unavailable, say what is missing.

Reply with the report path and the live URL.`;
}
