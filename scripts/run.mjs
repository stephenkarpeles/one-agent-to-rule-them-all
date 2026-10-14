import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function supportsAgent(version) {
  const [major = 0, minor = 0] = version.split(".").map(Number);
  return major > 22 || (major === 22 && minor >= 13);
}

function inspect(bin) {
  if (!existsSync(bin)) return undefined;
  const result = spawnSync(bin, ["-p", "process.versions.node + ' ' + process.arch"], {
    encoding: "utf8",
  });
  if (result.status !== 0) return undefined;
  const [version, arch] = result.stdout.trim().split(/\s+/);
  if (!version || !supportsAgent(version)) return undefined;
  return { bin, version, arch };
}

function candidates() {
  const found = [process.execPath, "/usr/local/bin/node", "/opt/homebrew/bin/node"];
  const nvmRoot = path.join(os.homedir(), ".nvm", "versions", "node");
  if (existsSync(nvmRoot)) {
    for (const name of readdirSync(nvmRoot)) {
      found.push(path.join(nvmRoot, name, "bin", "node"));
    }
  }
  return [...new Set(found)];
}

function byNewest(a, b) {
  const pa = a.version.split(".").map(Number);
  const pb = b.version.split(".").map(Number);
  for (let i = 0; i < 3; i += 1) {
    const diff = (pb[i] ?? 0) - (pa[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

const available = candidates().map(inspect).filter((item) => item !== undefined);
const sameArch = available.filter((item) => item.arch === process.arch);
const pick = (sameArch.length > 0 ? sameArch : available).sort(byNewest)[0];

if (!pick) {
  console.error(
    `Node ${process.versions.node} is too old for @cursor/sdk. Install Node 22.13 or newer and run again.`,
  );
  process.exit(1);
}

const child = spawnSync(pick.bin, [path.join(root, "dist", "cli.js"), ...process.argv.slice(2)], {
  cwd: root,
  stdio: "inherit",
});

if (child.error) {
  console.error(child.error.message);
  process.exit(1);
}

process.exit(child.status ?? 1);
