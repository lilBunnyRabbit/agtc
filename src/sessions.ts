import { DAY } from "./lib/time";
import { buildSearchText } from "./search";
import type { SeenStore } from "./seen-store";
import { type Session, type SessionInput, STATUS_PRIORITY } from "./session";
import { claudeSessions } from "./sources/claude";
import { codexSessions } from "./sources/codex";
import { gitChanges } from "./sources/git";
import { terminalTabs } from "./sources/terminal";
import { tmuxPanes } from "./sources/tmux";
import type { Surfaces } from "./sources/types";

export interface CollectOptions {
  /** How many days of inactive sessions to include. */
  days: number;
  seen: SeenStore;
}

/** Every known session from every source, sorted for display. */
export async function collectSessions({ days, seen }: CollectOptions): Promise<Session[]> {
  const sinceMs = Date.now() - days * DAY;
  const tabs = await terminalTabs();
  const surfaces: Surfaces = new Map([...tabs, ...(await tmuxPanes(tabs))]);
  const [claude, codex] = await Promise.all([claudeSessions({ surfaces, sinceMs }), codexSessions({ surfaces, sinceMs })]);
  const withChanges = await Promise.all([...claude, ...codex].map(attachChanges));
  return sortSessions(withChanges.map((session) => finalize(resolveDone(session, surfaces, seen))));
}

/** Git state is only worth polling for sessions that are running. */
async function attachChanges(session: SessionInput): Promise<SessionInput> {
  if (session.status === "inactive" || !session.root) return session;
  return { ...session, changes: await gitChanges(session.root) };
}

/** The session as it looks once you have seen its output. */
export function asSeen(session: Session): Session {
  return session.status === "done" ? finalize({ ...session, status: "idle" }) : session;
}

/**
 * An idle session whose turn finished after your last prompt is "done" until you look at it.
 * Looking at it means its tab or pane is in front right now (recorded here), or it was focused
 * or marked from the TUI.
 */
function resolveDone(session: SessionInput, surfaces: Surfaces, seen: SeenStore): SessionInput {
  const { id, status, completedAt, lastPromptAt, tty } = session;
  const finishedAfterPrompt = status === "idle" && !!completedAt && !!lastPromptAt && completedAt > lastPromptAt;
  if (!finishedAfterPrompt) return session;
  if (tty && surfaces.get(tty)?.viewed) seen.mark(id);
  return seen.seenAt(id) >= completedAt ? session : { ...session, status: "done" };
}

function finalize(session: SessionInput): Session {
  return { ...session, searchText: buildSearchText(session) };
}

/** Repos ordered by their most urgent session, then sessions by urgency, then newest first. */
function sortSessions(sessions: Session[]): Session[] {
  const repoRank = new Map<string, number>();
  for (const { repo, status } of sessions) {
    repoRank.set(repo, Math.min(repoRank.get(repo) ?? Infinity, STATUS_PRIORITY[status]));
  }
  return sessions.sort(
    (a, b) =>
      repoRank.get(a.repo)! - repoRank.get(b.repo)! ||
      a.repo.localeCompare(b.repo) ||
      STATUS_PRIORITY[a.status] - STATUS_PRIORITY[b.status] ||
      b.since - a.since,
  );
}
