export interface MetricRow {
  label: string;
  pageviews: number;
  visitors: number;
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
    return lines.join("\n");
  }

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
  return lines.join("\n");
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
