export interface MetricRow {
  label: string;
  pageviews: number;
  visitors: number;
}

export interface SignupRecord {
  email: string;
  signedUpAt: string;
}

export interface SignupSnapshot {
  available: boolean;
  reason?: string;
  count: number;
  signups: SignupRecord[];
  fetchedAt: string;
}

export interface TrafficSnapshot {
  available: boolean;
  reason?: string;
  since: string;
  until: string;
  pageviews: number | null;
  visitors: number | null;
  byDay: MetricRow[];
  byCountry: MetricRow[];
  byDevice: MetricRow[];
  byReferrer: MetricRow[];
  byCampaign: MetricRow[];
  byPath: MetricRow[];
  projectId?: string;
  url?: string;
  fetchedAt: string;
}

export function renderReport(input: {
  title: string;
  url?: string;
  narrative: string;
  traffic: TrafficSnapshot;
  signups: SignupSnapshot;
  preparedAt: Date;
}): string {
  const when = input.preparedAt.toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC");
  const lines = [
    `# Marketing report: ${input.title}`,
    "",
    `Prepared ${when} for the marketing owner.`,
    "",
    `**Live site:** ${input.url ?? "not deployed"}`,
    "",
    "## What this means",
    "",
    input.narrative.trim(),
    "",
    "The tables below are the measured numbers.",
    "",
    "## Traffic",
    "",
  ];

  if (!input.traffic.available) {
    lines.push(
      `Web Analytics did not return numbers for ${input.traffic.since} to ${input.traffic.until} (UTC).`,
      "",
      input.traffic.reason ?? "No reason was returned.",
      "",
      "Turn on Web Analytics for this project in Vercel. The deployed page already loads the analytics script. After that, run the report command again.",
      "",
    );
  } else {
    lines.push(
      `Window: ${input.traffic.since} to ${input.traffic.until} (UTC).`,
      "",
      "| | Page views | Visitors |",
      "| --- | ---: | ---: |",
      `| This window | ${formatCount(input.traffic.pageviews)} | ${formatCount(input.traffic.visitors)} |`,
      "",
      "### By day",
      "",
      table(input.traffic.byDay),
      "### Top countries",
      "",
      table(input.traffic.byCountry),
      "### Devices",
      "",
      table(input.traffic.byDevice),
      "### Referrers",
      "",
      table(input.traffic.byReferrer),
      "### UTM sources",
      "",
      table(input.traffic.byCampaign),
      "### Paths",
      "",
      table(input.traffic.byPath),
    );
  }

  lines.push("## Waitlist", "", waitlistSection(input.signups));
  return lines.join("\n");
}

function waitlistSection(signups: SignupSnapshot): string {
  if (!signups.available) {
    return [signups.reason ?? "Email addresses are not being saved yet.", ""].join("\n");
  }
  if (signups.signups.length === 0) return "Nobody has signed up yet.\n";
  const noun = signups.count === 1 ? "person has" : "people have";
  const rows = signups.signups.map(
    (signup) => `| ${escapeCell(signup.email)} | ${formatWhen(signup.signedUpAt)} |`,
  );
  return [
    `${signups.count.toLocaleString("en-US")} ${noun} signed up.`,
    "",
    "| Email | Signed up |",
    "| --- | --- |",
    ...rows,
    "",
  ].join("\n");
}

function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC");
}

function formatCount(value: number | null): string {
  if (value === null) return "n/a";
  return value.toLocaleString("en-US");
}

function table(rows: MetricRow[]): string {
  if (rows.length === 0) return "_No data in this window._\n";
  const body = rows.map(
    (row) =>
      `| ${escapeCell(row.label)} | ${row.pageviews.toLocaleString("en-US")} | ${row.visitors.toLocaleString("en-US")} |`,
  );
  return ["| | Page views | Visitors |", "| --- | ---: | ---: |", ...body, ""].join("\n");
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ");
}
