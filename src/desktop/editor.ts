import { existsSync } from "node:fs";
import { join } from "node:path";
import { launch } from "../lib/shell";
import { type Session, workDir } from "../model/session";
import { tmuxFreeEnv } from "../tmux/env";

const EDITOR = process.env.AGTC_EDITOR || "zed";

/**
 * `--existing` switches to the workspace whose root is this checkout, in any window, or adds one
 * to the open window's sidebar. `--add` would merge the folder into the current workspace instead.
 */
const ZED_FLAGS = ["--existing"];

/** Zed keeps the caller's environment for the project's terminals, so tmux's variables stay out: `agtc attach` there must see a plain terminal. */
export function openInEditor(session: Session): string | undefined {
  const dir = workDir(session);
  const file = session.changes?.paths.map((path) => join(dir, path)).find((path) => !path.endsWith("/") && existsSync(path));
  const argv = editorArgv(dir, file);
  return launch(argv, tmuxFreeEnv()) ? argv.join(" ") : undefined;
}

export function editorArgv(dir: string, file?: string): string[] {
  return [EDITOR, ...(EDITOR === "zed" ? ZED_FLAGS : []), dir, ...(file ? [file] : [])];
}

