import { existsSync } from "node:fs";
import type { Session } from "../model/session";
import type { HubWindow } from "../model/state-store";
import { resumeInvocation } from "../model/tools";
import { newTmuxWindow } from "./windows";

export interface Restored {
  opened: HubWindow[];
  skipped: HubWindow[];
}

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
