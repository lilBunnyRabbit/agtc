import { existsSync } from "node:fs";
import { join } from "node:path";
import { launch } from "./lib/shell";
import { type Session, workDir } from "./session";

const EDITOR = process.env.AGTC_EDITOR || "zed";

/**
 * Zed: `--existing` switches to the workspace whose root is this checkout, in any window, or adds
 * one to the open window's sidebar. `--add` would instead merge the folder into the current
 * workspace, so every checkout ends up in one project and nothing visibly changes.
 */
const ZED_FLAGS = ["--existing"];

/** Opens the session's checkout in the editor, at its most recently changed file. Returns the command run. */
export function openInEditor(session: Session): string | undefined {
  const dir = workDir(session);
  const file = session.changes?.paths.map((path) => join(dir, path)).find((path) => !path.endsWith("/") && existsSync(path));
  const argv = [EDITOR, ...(EDITOR === "zed" ? ZED_FLAGS : []), dir, ...(file ? [file] : [])];
  return launch(argv) ? argv.join(" ") : undefined;
}
