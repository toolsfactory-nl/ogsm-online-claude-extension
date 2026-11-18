// Packs the extension from a staging directory with production dependencies only, so the
// .mcpb never picks up devDependencies (such as @anthropic-ai/mcpb) from a dev install.
//
//   node scripts/pack.js [output.mcpb]     (default: ogsm-online.mcpb)
//
// Needs the dev install in the repository root (npm ci) for the mcpb CLI.

import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const output = resolve(process.argv[2] ?? "ogsm-online.mcpb");
const mcpb = join(root, "node_modules", "@anthropic-ai", "mcpb", "dist", "cli", "cli.js");
if (!existsSync(mcpb)) {
  console.error(`mcpb CLI not found at ${mcpb}; run npm ci first.`);
  process.exit(1);
}

// Everything the package needs at runtime, plus the lock file for a reproducible install.
const files = ["manifest.json", "package.json", "package-lock.json", "LICENSE", "README.md", ".mcpbignore", "server"];
for (const optional of ["icon.png"]) if (existsSync(join(root, optional))) files.push(optional);

const stage = mkdtempSync(join(tmpdir(), "ogsm-mcpb-"));
try {
  for (const file of files) cpSync(join(root, file), join(stage, file), { recursive: true });
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  execFileSync(npm, ["ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"], {
    cwd: stage,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  execFileSync(process.execPath, [mcpb, "pack", stage, output], { stdio: "inherit" });
} finally {
  rmSync(stage, { recursive: true, force: true });
}
