import { realpathSync } from "node:fs";
import { STATE_FILE } from "../paths";
import { gitRootOfDir } from "../sources/git";
import { type Session, STATUS_PRIORITY, workDir } from "./session";
import { collectSessions } from "./sessions";
import { StateStore } from "./state-store";

const LOOKUP_DAYS = 1;

/** Nearest checkout wins, so a worktree nested under the main checkout never matches the main checkout's agents. */
export async function agentIn(dir: string): Promise<Session | undefined> {
  const target = realpath(dir);
  const checkout = realpath(gitRootOfDir(target) ?? target);
  const state = StateStore.load(STATE_FILE);
  const preferred = state.openedIn(checkout);
  const sessions = await collectSessions({ days: LOOKUP_DAYS, state });
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
