import { DAY } from "./lib/time";
import { buildSearchText } from "./search";
import type { SeenStore } from "./seen-store";
import { type Session, type SessionInput, STATUS_PRIORITY } from "./session";
import { claudeSessions } from "./sources/claude";
import { codexSessions } from "./sources/codex";
import { type TerminalTabs, terminalTabs } from "./sources/terminal";

export interface CollectOptions {
  /** How many days of inactive sessions to include. */
  days: number;
  seen: SeenStore;
}

/** Every known session from every source, sorted for display. */
export async function collectSessions({ days, seen }: CollectOptions): Promise<Session[]> {
  const sinceMs = Date.now() - days * DAY;
  const tabs = await terminalTabs();
  const [claude, codex] = await Promise.all([claudeSessions({ tabs, sinceMs }), codexSessions({ tabs, sinceMs })]);
  const sessions = [...claude, ...codex].map((session) => finalize(resolveDone(session, tabs, seen)));
  return sortSessions(sessions);
}

/** The session as it looks once you have seen its output. */
export function asSeen(session: Session): Session {
  return session.status === "done" ? finalize({ ...session, status: "idle" }) : session;
}

/**
 * An idle session whose turn finished after your last prompt is "done" until you look at it.
 * Looking at it means its tab is in front right now (recorded here), or it was focused
 * or marked from the TUI.
 */
function resolveDone(session: SessionInput, tabs: TerminalTabs, seen: SeenStore): SessionInput {
  const { id, status, completedAt, lastPromptAt, tty } = session;
  const finishedAfterPrompt = status === "idle" && !!completedAt && !!lastPromptAt && completedAt > lastPromptAt;
  if (!finishedAfterPrompt) return session;
  if (tty && tabs.get(tty)?.viewed) seen.mark(id);
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
