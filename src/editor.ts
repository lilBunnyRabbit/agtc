import { existsSync } from "node:fs";
import { join } from "node:path";
import { launch } from "./lib/shell";
import { type Session, workDir } from "./session";
import { tmuxFreeEnv } from "./sources/tmux";

const EDITOR = process.env.AGTC_EDITOR || "zed";

/**
 * Zed: `--existing` switches to the workspace whose root is this checkout, in any window, or adds
 * one to the open window's sidebar. `--add` would instead merge the folder into the current
 * workspace, so every checkout ends up in one project and nothing visibly changes.
 */
const ZED_FLAGS = ["--existing"];

/**
 * Opens the session's checkout in the editor, at its most recently changed file. Returns the
 * command run. Zed keeps the caller's environment for the project's terminals, so tmux's
 * variables stay out of it: `agtc attach` there must see a plain terminal.
 */
export function openInEditor(session: Session): string | undefined {
  const dir = workDir(session);
  const file = session.changes?.paths.map((path) => join(dir, path)).find((path) => !path.endsWith("/") && existsSync(path));
  const argv = editorArgv(dir, file);
  return launch(argv, tmuxFreeEnv()) ? argv.join(" ") : undefined;
}

/** The editor on a checkout, and on one of its files when given. */
export function editorArgv(dir: string, file?: string): string[] {
  return [EDITOR, ...(EDITOR === "zed" ? ZED_FLAGS : []), dir, ...(file ? [file] : [])];
}

/** The editor at a line of a file. Zed takes `path:line`; any other editor gets the file. */
export function editorArgvAtLine(dir: string, path: string, line: number): string[] {
  const file = join(dir, path);
  return editorArgv(dir, EDITOR === "zed" ? `${file}:${line}` : file);
}
