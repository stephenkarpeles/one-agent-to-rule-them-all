import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

export function loadEnv(root: string): void {
  const file = path.join(root, ".env");
  if (!existsSync(file)) return;

  for (const line of readFileSync(file, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

export function assertNodeVersion(): void {
  const [major = 0, minor = 0] = process.versions.node.split(".").map(Number);
  if (major > 22 || (major === 22 && minor >= 13)) return;
  console.error(
    `Node ${process.versions.node} is too old for @cursor/sdk. Install Node 22.13 or newer and run again.`,
  );
  process.exit(1);
}

export function vercelToken(): string | undefined {
  return process.env.VERCEL_TOKEN || process.env.VERCEL_ACCESS_TOKEN;
}

export function teamQuery(): Record<string, string> {
  if (process.env.VERCEL_TEAM_ID) return { teamId: process.env.VERCEL_TEAM_ID };
  if (process.env.VERCEL_TEAM_SLUG) return { slug: process.env.VERCEL_TEAM_SLUG };
  return {};
}
