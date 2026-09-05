import { collapse } from "../../lib/text";
import { type SessionInput, type Status, TITLE_MAX_LENGTH } from "../../session";
import { type GitInfo, gitInfo } from "../git";
import { processInfo } from "../processes";
import type { TerminalTabs } from "../terminal";
import type { SourceOptions } from "../types";
import { type ClaudeHistory, readClaudeHistory } from "./history";
import { type ClaudeRegistration, readClaudeRegistry } from "./registry";

/** Claude animates one of these at the start of the tab title while it works. */
const SPINNER_GLYPHS = /^[◐◑◒◓◴◵◶◷⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/;

/** Drops the status glyph Claude prefixes to tab titles. */
const stripTitleGlyph = (title: string) => title.replace(/^[^\p{L}\p{N}]+\s*/u, "").trim();

/** Live Claude Code sessions, plus recent finished ones from history. */
export async function claudeSessions({ tabs, sinceMs }: SourceOptions): Promise<SessionInput[]> {
  const registry = readClaudeRegistry();
  const history = readClaudeHistory();
  const liveIds = new Set(registry.map((r) => r.sessionId));
  const inactive = [...history].filter(([id, h]) => !liveIds.has(id) && h.lastAt >= sinceMs && h.project);

  const [processes, liveGit, inactiveGit] = await Promise.all([
    processInfo(registry.map((r) => r.pid)),
    Promise.all(registry.map((r) => gitInfo(r.cwd))),
    Promise.all(inactive.map(([, h]) => gitInfo(h.project))),
  ]);

  const live = registry.map((registration, i) =>
    liveSession(registration, history.get(registration.sessionId), liveGit[i], processes.get(registration.pid)?.tty, tabs),
  );
  const finished = inactive.map(([id, h], i) => inactiveSession(id, h, inactiveGit[i]));
  return [...live, ...finished];
}

function liveSession(
  registration: ClaudeRegistration,
  history: ClaudeHistory | undefined,
  git: GitInfo,
  tty: string | undefined,
  tabs: TerminalTabs,
): SessionInput {
  const tabTitle = tty ? tabs.get(tty)?.title : undefined;
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
    title,
    firstPrompt: history?.firstPrompt,
    lastPrompt: history?.lastPrompt,
    lastPromptAt: history?.lastAt,
    completedAt: status === "idle" ? statusAt : undefined,
    prompts: history?.prompts ?? [],
    since: statusAt,
    tty,
  };
}

function inactiveSession(id: string, history: ClaudeHistory, git: GitInfo): SessionInput {
  return {
    tool: "claude",
    id,
    status: "inactive",
    cwd: history.project,
    ...git,
    title: collapse(history.firstPrompt, TITLE_MAX_LENGTH) || id.slice(0, 8),
    firstPrompt: history.firstPrompt,
    lastPrompt: history.lastPrompt,
    prompts: history.prompts,
    since: history.lastAt,
  };
}
