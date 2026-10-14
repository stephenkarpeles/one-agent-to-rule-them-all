import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export function ensureRipgrep(): void {
  const current = process.env.CURSOR_RIPGREP_PATH;
  if (current && path.isAbsolute(current) && canRun(current)) return;

  const found = findRipgrep();
  if (!found) {
    console.error(
      "ripgrep was not found, so the agent cannot read .gitignore. Install it with `brew install ripgrep`, or set CURSOR_RIPGREP_PATH to the rg binary.",
    );
    return;
  }
  process.env.CURSOR_RIPGREP_PATH = found;
}

function findRipgrep(): string | undefined {
  const candidates: string[] = [];
  const which = spawnSync("which", ["rg"], { encoding: "utf8" });
  if (which.status === 0 && which.stdout.trim()) candidates.push(which.stdout.trim());

  candidates.push(
    "/opt/homebrew/bin/rg",
    "/usr/local/bin/rg",
    "/Applications/Cursor.app/Contents/Resources/app/node_modules/@vscode/ripgrep/bin/rg",
  );

  const versionsDir = path.join(
    os.homedir(),
    "Library/Application Support/Cursor/User/globalStorage/anysphere.cursor-agent-worker/agent-cli/.local/share/cursor-agent/versions",
  );
  if (existsSync(versionsDir)) {
    const versions = readdirSync(versionsDir).sort().reverse();
    for (const version of versions) candidates.push(path.join(versionsDir, version, "rg"));
  }

  return candidates.find((candidate) => canRun(candidate));
}

function canRun(bin: string): boolean {
  if (!path.isAbsolute(bin) || !existsSync(bin)) return false;
  const result = spawnSync(bin, ["--version"], { encoding: "utf8" });
  return result.status === 0;
}
