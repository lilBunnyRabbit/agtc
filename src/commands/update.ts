import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import pkg from "../../package.json";
import { readJson } from "../lib/files";

const PACKAGE_NAME = pkg.name;
const PACKAGE_ROOT = resolve(import.meta.dir, "..");

export type InstallKind = "checkout" | "bun-global" | "bunx" | "npm-global";

export function detectInstall(root = PACKAGE_ROOT): InstallKind {
  if (existsSync(join(root, ".git"))) return "checkout";
  if (root.includes("/.bun/install/global/")) return "bun-global";
  if (root.includes("/.bun/install/cache/")) return "bunx";
  if (root.includes("/node_modules/")) return "npm-global";
  return "checkout";
}

export async function selfUpdate(): Promise<number> {
  const kind = detectInstall();
  const spec = `${PACKAGE_NAME}@latest`;

  switch (kind) {
    case "checkout":
      console.log(`agtc ${pkg.version} runs from a checkout at ${PACKAGE_ROOT}. Update it with git pull.`);
      return 0;
    case "bunx":
      console.log(`agtc ${pkg.version} runs through bunx, which resolves the newest version by itself.`);
      console.log(`Force a fresh copy with: bunx ${spec}`);
      return 0;
    case "bun-global":
      // process.execPath is the bun binary running us; @latest also rewrites the ^0.x range
      // in the global package.json, which would otherwise never cross a minor version.
      return install([process.execPath, "add", "-g", spec]);
    case "npm-global":
      return install(["npm", "install", "-g", spec]);
  }
}

async function install(argv: string[]): Promise<number> {
  console.log(`agtc ${pkg.version}: running ${argv.map((a, i) => (i === 0 ? "bun" : a)).join(" ")}`);
  const proc = Bun.spawn(argv, { stdin: "inherit", stdout: "inherit", stderr: "inherit" });
  const code = await proc.exited;
  if (code !== 0) return code;

  const installed = readJson<{ version?: string }>(join(PACKAGE_ROOT, "package.json"))?.version;
  if (!installed || installed === pkg.version) console.log(`agtc ${pkg.version} is already the latest version.`);
  else console.log(`agtc ${pkg.version} → ${installed}`);
  return 0;
}
