import { existsSync } from "node:fs";
import type { HubWindow } from "./seen-store";
import { type Session, resumeInvocation } from "./session";
import { newTmuxWindow } from "./sources/tmux";

export interface Restored {
  /** Windows opened again, in order. */
  opened: HubWindow[];
  /** Windows whose session is running already or whose directory is gone. */
  skipped: HubWindow[];
}

/**
 * Brings back the agent windows of the last hub: one tmux window per remembered session,
 * named as before, running the tool's resume command in the session's directory. Sessions
 * that run already are left alone, so pressing it twice is harmless.
 */
export async function restoreHub(windows: HubWindow[], live: Session[], tmuxSession: string | undefined): Promise<Restored> {
  const running = new Set(live.filter((s) => s.status !== "inactive").map((s) => s.id));
  const result: Restored = { opened: [], skipped: [] };
  for (const window of windows) {
    if (running.has(window.id) || !existsSync(window.cwd)) {
      result.skipped.push(window);
      continue;
    }
    const paneId = await newTmuxWindow(window.cwd, resumeInvocation(window), tmuxSession, window.name);
    (paneId ? result.opened : result.skipped).push(window);
  }
  return result;
}
