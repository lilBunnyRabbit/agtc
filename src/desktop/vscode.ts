import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isProcessAlive, launch } from "../lib/shell";
import { CLAUDE_DIR, HOME } from "../paths";
import { tmuxFreeEnv } from "../tmux/env";

const DIR = join(HOME, ".cache", "agtc", "vscode");
export const WORKSPACE_FILE = join(DIR, "agtc.code-workspace");
/**
 * Stays the window's first folder for good. VS Code restarts its extensions when the first
 * folder changes, which drops every Claude Code link; folders after it swap freely.
 */
const ANCHOR = join(DIR, "agtc");
const IDE_DIR = join(CLAUDE_DIR, "ide");
const CODE = ["code", "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code"];
const POLL_MS = 200;
const KNOWS_TIMEOUT_MS = 4000;

interface Folder {
  path: string;
  name?: string;
}

interface Workspace {
  folders: Folder[];
  [key: string]: unknown;
}

/** Settings VS Code wrote into the file stay; only the folder after the anchor changes. */
export function withCheckout(current: string | undefined, dir: string, anchor = ANCHOR): string {
  const workspace: Workspace = { ...parse(current), folders: [{ name: "agtc", path: anchor }, { path: dir }] };
  return `${JSON.stringify(workspace, null, 2)}\n`;
}

export function checkoutIn(current: string | undefined): string | undefined {
  return parse(current)?.folders[1]?.path;
}

function parse(text: string | undefined): Workspace | undefined {
  try {
    const parsed = JSON.parse(text ?? "");
    return Array.isArray(parsed?.folders) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

const read = (path: string) => (existsSync(path) ? readFileSync(path, "utf8") : undefined);

export function showCheckout(dir: string): void {
  mkdirSync(ANCHOR, { recursive: true });
  writeFileSync(WORKSPACE_FILE, withCheckout(read(WORKSPACE_FILE), dir));
}

/** The folders of our window as Claude Code's extension reports them, so only while that window is open. */
function windowFolders(): string[] | undefined {
  if (!existsSync(IDE_DIR)) return undefined;
  for (const name of readdirSync(IDE_DIR)) {
    if (!name.endsWith(".lock")) continue;
    try {
      const { pid, workspaceFolders } = JSON.parse(readFileSync(join(IDE_DIR, name), "utf8"));
      if (Array.isArray(workspaceFolders) && workspaceFolders.includes(ANCHOR) && isProcessAlive(pid)) return workspaceFolders;
    } catch {}
  }
  return undefined;
}

export const windowOpen = () => windowFolders() !== undefined;

export function shownCheckout(): string | undefined {
  return windowOpen() ? checkoutIn(read(WORKSPACE_FILE)) : undefined;
}

export function openWindow(): boolean {
  return CODE.some((code) => (code.includes("/") ? existsSync(code) : !!Bun.which(code)) && launch([code, WORKSPACE_FILE], tmuxFreeEnv()));
}

/** Claude Code offers an editor only for a directory inside its folders, and the extension reports a swap a moment late. */
export async function editorKnows(dir: string): Promise<boolean> {
  for (let waited = 0; waited <= KNOWS_TIMEOUT_MS; waited += POLL_MS) {
    if (windowFolders()?.includes(dir)) return true;
    await Bun.sleep(POLL_MS);
  }
  return false;
}
