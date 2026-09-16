import { realpathSync } from "node:fs";
import { STATE_FILE } from "./paths";
import { SeenStore } from "./seen-store";
import { type Session, STATUS_PRIORITY, workDir } from "./session";
import { collectSessions } from "./sessions";
import { gitRootOfDir } from "./sources/git";

const LOOKUP_DAYS = 1;

/**
 * The running agent for a directory: one working in the checkout that contains it. The checkout
 * is the nearest one, so a worktree nested under the main checkout never matches the main
 * checkout's agents. Several agents in one checkout: the one last opened from agtc, else one
 * that can be attached to, then the one that needs you most, then the most recent.
 */
export async function agentIn(dir: string): Promise<Session | undefined> {
  const target = realpath(dir);
  const checkout = realpath(gitRootOfDir(target) ?? target);
  const seen = SeenStore.load(STATE_FILE);
  const preferred = seen.openedIn(checkout);
  const sessions = await collectSessions({ days: LOOKUP_DAYS, seen });
  return sessions
    .filter((session) => session.status !== "inactive" && realpath(workDir(session)) === checkout)
    .sort(
      (a, b) =>
        Number(b.id === preferred) - Number(a.id === preferred) ||
        Number(!!b.tmux) - Number(!!a.tmux) ||
        STATUS_PRIORITY[a.status] - STATUS_PRIORITY[b.status] ||
        b.since - a.since,
    )[0];
}

function realpath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}
