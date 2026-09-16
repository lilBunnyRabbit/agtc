import { DAY } from "./lib/time";
import { buildSearchText } from "./search";
import type { HubWindow, SeenStore } from "./seen-store";
import type { Session, SessionInput } from "./session";
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
  const sessions = sortSessions(withChanges.map((session) => finalize(resolveDone(session, surfaces, seen))));
  seen.rememberHub(hubWindows(sessions));
  return sessions;
}

/** Live agents inside tmux in window order, as they would be recreated. */
function hubWindows(sessions: Session[]): HubWindow[] {
  return sessions
    .filter((s) => s.tmux && s.status !== "inactive")
    .sort((a, b) => a.tmux!.session.localeCompare(b.tmux!.session) || a.tmux!.windowIndex - b.tmux!.windowIndex)
    .map(({ id, tool, cwd, tmux }) => ({ id, tool, cwd, name: tmux!.windowName }));
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

/**
 * A fixed order, so nothing moves when a status changes: repos alphabetically, live sessions
 * in the order they started, finished ones below them newest first. Colour says what is urgent.
 */
function sortSessions(sessions: Session[]): Session[] {
  const inactive = (s: Session) => Number(s.status === "inactive");
  return sessions.sort(
    (a, b) =>
      a.repo.localeCompare(b.repo) ||
      inactive(a) - inactive(b) ||
      (inactive(a) ? b.since - a.since : (a.startedAt ?? 0) - (b.startedAt ?? 0) || (a.pid ?? 0) - (b.pid ?? 0)) ||
      a.id.localeCompare(b.id),
  );
}
