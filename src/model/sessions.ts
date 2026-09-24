import { DAY } from "../lib/time";
import { claudeSessions } from "../sources/claude";
import { codexSessions } from "../sources/codex";
import { gitChanges } from "../sources/git";
import { terminalTabs } from "../sources/terminal";
import { tmuxPanes } from "../sources/tmux";
import type { Surfaces } from "../sources/types";
import { reviewerVerdict } from "../review/report";
import { buildSearchText } from "./search";
import type { Session, SessionInput } from "./session";
import type { HubWindow, StateStore } from "./state-store";

export interface CollectOptions {
  days: number;
  state: StateStore;
}

export async function collectSessions({ days, state }: CollectOptions): Promise<Session[]> {
  const sinceMs = Date.now() - days * DAY;
  const tabs = await terminalTabs();
  const surfaces: Surfaces = new Map([...tabs, ...(await tmuxPanes(tabs))]);
  const [claude, codex] = await Promise.all([claudeSessions({ surfaces, sinceMs }), codexSessions({ surfaces, sinceMs })]);
  const withChanges = await Promise.all([...claude, ...codex].map(attachChanges));
  const linked = linkReviews(withChanges, state);
  const sessions = sortSessions(linked.map((session) => withVerdict(finalize(resolveDone(onScreen(session, surfaces), state)))));
  state.rememberHub(hubWindows(sessions));
  return sessions;
}

function hubWindows(sessions: Session[]): HubWindow[] {
  return sessions
    .filter((s) => s.tmux && s.status !== "inactive")
    .sort((a, b) => a.tmux!.session.localeCompare(b.tmux!.session) || a.tmux!.windowIndex - b.tmux!.windowIndex)
    .map(({ id, tool, cwd, tmux, reviewOf }) => ({ id, tool, cwd, name: tmux!.windowName, ...(reviewOf ? { reviewOf } : {}) }));
}

async function attachChanges(session: SessionInput): Promise<SessionInput> {
  if (session.status === "inactive" || !session.root) return session;
  return { ...session, changes: await gitChanges(session.root) };
}

function linkReviews(sessions: SessionInput[], state: StateStore): SessionInput[] {
  const byId = new Map(sessions.map((s) => [s.id, s]));
  return sessions.map((session) => {
    const link = state.reviewLinkOf(session);
    if (!link) return session;
    const subject = byId.get(link.of);
    return { ...session, reviewOf: link.of, title: subject ? `review of ${subject.title}` : "review" };
  });
}

function onScreen(session: SessionInput, surfaces: Surfaces): SessionInput {
  return { ...session, viewed: !!session.tty && !!surfaces.get(session.tty)?.viewed };
}

function withVerdict(session: Session): Session {
  if (!session.reviewOf) return session;
  const verdict = reviewerVerdict(session);
  return verdict ? { ...session, verdict } : session;
}

export function asSeen(session: Session): Session {
  return session.status === "done" ? finalize({ ...session, status: "idle" }) : session;
}

/**
 * An idle session whose turn finished after your last prompt is "done" until you look at it:
 * its tab or pane is in front right now (recorded here), or it was focused or marked from the TUI.
 */
function resolveDone(session: SessionInput, state: StateStore): SessionInput {
  const { id, status, completedAt, lastPromptAt, viewed } = session;
  const finishedAfterPrompt = status === "idle" && !!completedAt && !!lastPromptAt && completedAt > lastPromptAt;
  if (!finishedAfterPrompt) return session;
  if (viewed) state.mark(id);
  return state.seenAt(id) >= completedAt ? session : { ...session, status: "done" };
}

function finalize(session: SessionInput): Session {
  return { ...session, searchText: buildSearchText(session) };
}

/**
 * A fixed order, so nothing moves when a status changes: repos alphabetically, live sessions
 * in the order they started, finished ones below them newest first.
 */
export function sortSessions(sessions: Session[]): Session[] {
  const inactive = (s: Session) => Number(s.status === "inactive");
  const sorted = [...sessions].sort(
    (a, b) =>
      a.repo.localeCompare(b.repo) ||
      inactive(a) - inactive(b) ||
      (inactive(a) ? b.since - a.since : (a.startedAt ?? 0) - (b.startedAt ?? 0) || (a.pid ?? 0) - (b.pid ?? 0)) ||
      a.id.localeCompare(b.id),
  );
  return nestReviews(sorted);
}

/** Reviewers move right under the session they review; one whose subject is not listed stays put. */
function nestReviews(sessions: Session[]): Session[] {
  const ids = new Set(sessions.map((s) => s.id));
  const under = (id: string) => sessions.filter((s) => s.reviewOf === id);
  return sessions.flatMap((s) => (s.reviewOf ? (ids.has(s.reviewOf) ? [] : [s]) : [s, ...under(s.id)]));
}
