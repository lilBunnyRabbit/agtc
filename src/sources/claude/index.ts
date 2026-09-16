import { collapse } from "../../lib/text";
import { type SessionInput, type Status, TITLE_MAX_LENGTH } from "../../session";
import { type GitInfo, gitInfo, repoCheckouts } from "../git";
import { processInfo } from "../processes";
import type { SourceOptions, Surfaces } from "../types";
import { type ClaudeHistory, readClaudeHistory } from "./history";
import { type ClaudeRegistration, readClaudeRegistry } from "./registry";
import { type TranscriptActivity, transcriptActivity } from "./transcript";

/** Claude animates one of these at the start of the tab title while it works. */
const SPINNER_GLYPHS = /^[◐◑◒◓◴◵◶◷⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/;

/** Drops the status glyph Claude prefixes to tab titles. */
const stripTitleGlyph = (title: string) => title.replace(/^[^\p{L}\p{N}]+\s*/u, "").trim();

/** Live Claude Code sessions, plus recent finished ones from history. */
export async function claudeSessions({ surfaces, sinceMs }: SourceOptions): Promise<SessionInput[]> {
  const registry = readClaudeRegistry();
  const history = readClaudeHistory();
  const liveIds = new Set(registry.map((r) => r.sessionId));
  const inactive = [...history].filter(([id, h]) => !liveIds.has(id) && h.lastAt >= sinceMs && h.project);

  const [processes, liveWork, inactiveGit] = await Promise.all([
    processInfo(registry.map((r) => r.pid)),
    Promise.all(registry.map((r) => workCheckout(r.cwd, transcriptActivity(r.sessionId, r.cwd)))),
    Promise.all(inactive.map(([, h]) => gitInfo(h.project))),
  ]);

  const live = registry.map((registration, i) =>
    liveSession(registration, history.get(registration.sessionId), liveWork[i], processes.get(registration.pid)?.tty, surfaces),
  );
  const finished = inactive.map(([id, h], i) => inactiveSession(id, h, inactiveGit[i]));
  return [...live, ...finished];
}

interface WorkCheckout {
  git: GitInfo;
  /** Checkouts of the session's repository it works in, the busiest lately first. */
  roots: string[];
}

/** Paths considered when deciding where a session works: enough to outlast a stray `cd` or a peek at another checkout. */
const RECENT_PATHS = 12;

/**
 * The checkout the session works in right now: the one most of its recent tool calls touched,
 * ties to the latest. Only checkouts of the repository the session started in count, so writes
 * to memory, dotfiles or other repos cannot move it. Catches an agent that created a worktree
 * mid-session and moved into it, whether it edits with tools or through the shell. When the
 * starting cwd is not a checkout, the session stays where it started.
 */
async function workCheckout(startCwd: string, activity: TranscriptActivity): Promise<WorkCheckout> {
  const start = await gitInfo(startCwd);
  if (!start.root) return { git: start, roots: [] };

  const checkouts = await repoCheckouts(start.root);
  const checkoutOf = (path: string) => checkouts.find((c) => path === c || path.startsWith(`${c}/`));
  const recent = activity.paths.slice(0, RECENT_PATHS).map(checkoutOf).filter((c): c is string => !!c);
  const hits = new Map<string, number>();
  for (const checkout of recent) hits.set(checkout, (hits.get(checkout) ?? 0) + 1);
  const roots = [...hits.keys()].sort((a, b) => hits.get(b)! - hits.get(a)! || recent.indexOf(a) - recent.indexOf(b));
  const root = roots[0] ?? start.root;
  return { git: root === start.root ? start : await gitInfo(root), roots };
}

function liveSession(
  registration: ClaudeRegistration,
  history: ClaudeHistory | undefined,
  { git, roots }: WorkCheckout,
  tty: string | undefined,
  surfaces: Surfaces,
): SessionInput {
  const surface = tty ? surfaces.get(tty) : undefined;
  const tabTitle = surface?.title;
  const spinning = tabTitle ? SPINNER_GLYPHS.test(tabTitle) : false;
  const status: Status = registration.waitingFor ? "needs input" : registration.status === "busy" || spinning ? "busy" : "idle";
  const statusAt = registration.statusUpdatedAt ?? registration.updatedAt ?? registration.startedAt ?? Date.now();
  const title =
    (tabTitle && stripTitleGlyph(tabTitle)) ||
    (history?.firstPrompt && collapse(history.firstPrompt, TITLE_MAX_LENGTH)) ||
    registration.name ||
    registration.sessionId.slice(0, 8);

  return {
    tool: "claude",
    id: registration.sessionId,
    pid: registration.pid,
    status,
    waitingFor: registration.waitingFor,
    cwd: registration.cwd,
    ...git,
    roots,
    title,
    firstPrompt: history?.firstPrompt,
    lastPrompt: history?.lastPrompt,
    lastPromptAt: history?.lastAt,
    completedAt: status === "idle" ? statusAt : undefined,
    prompts: history?.prompts ?? [],
    since: statusAt,
    startedAt: registration.startedAt,
    tty,
    tmux: surface?.tmux,
  };
}

function inactiveSession(id: string, history: ClaudeHistory, git: GitInfo): SessionInput {
  return {
    tool: "claude",
    id,
    status: "inactive",
    cwd: history.project,
    ...git,
    roots: git.root ? [git.root] : [],
    title: collapse(history.firstPrompt, TITLE_MAX_LENGTH) || id.slice(0, 8),
    firstPrompt: history.firstPrompt,
    lastPrompt: history.lastPrompt,
    prompts: history.prompts,
    since: history.lastAt,
  };
}
