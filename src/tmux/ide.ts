import { stripAnsi } from "../tui/ansi";
import { succeeds } from "../lib/shell";
import { tmux } from "./env";

const PROMPT = "❯";
const DIM_RUN = /\x1b\[2m[^\x1b]*/g;
const PICKER = "Select IDE";
const POLL_MS = 200;
const PICKER_TIMEOUT_MS = 3000;

export type Linked = "asked" | "draft" | "no picker" | "no pane";

/** Claude Code paints its placeholder dim; anything else after the prompt is text the user is still writing. */
export function hasDraft(screen: string): boolean {
  const line = screen.split("\n").findLast((l) => stripAnsi(l).trimStart().startsWith(PROMPT));
  if (!line) return false;
  const typed = stripAnsi(line.replace(DIM_RUN, "")).replace(PROMPT, "");
  return typed.replace(/[\s ]/g, "") !== "";
}

/**
 * A running Claude Code picks its editor through `/ide` only. The picker lists the editors whose
 * folders hold the agent's directory, the connected one first, so enter takes ours.
 */
export async function askForIde(paneId: string): Promise<Linked> {
  const screen = await tmux("capture-pane", "-p", "-e", "-t", paneId);
  if (!screen) return "no pane";
  if (hasDraft(screen)) return "draft";
  await succeeds(["tmux", "send-keys", "-t", paneId, "-l", "/ide"]);
  await Bun.sleep(POLL_MS);
  await succeeds(["tmux", "send-keys", "-t", paneId, "Enter"]);
  for (let waited = 0; waited <= PICKER_TIMEOUT_MS; waited += POLL_MS) {
    await Bun.sleep(POLL_MS);
    if (!(await tmux("capture-pane", "-p", "-t", paneId)).includes(PICKER)) continue;
    await succeeds(["tmux", "send-keys", "-t", paneId, "Enter"]);
    return "asked";
  }
  return "no picker";
}
