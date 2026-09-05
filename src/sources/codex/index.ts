import { basename } from "node:path";
import { collapse } from "../../lib/text";
import { SECOND } from "../../lib/time";
import { PROMPT_MAX_LENGTH, type SessionInput, TITLE_MAX_LENGTH } from "../../session";
import { type GitInfo, gitInfo } from "../git";
import { type ProcessInfo, processInfo } from "../processes";
import type { TerminalTabs } from "../terminal";
import type { SourceOptions } from "../types";
import { type CodexProcess, findCodexProcesses } from "./processes";
import { summarizeRollout } from "./rollout";
import { type CodexThread, readCodexThreads } from "./threads";

/** Live Codex sessions, plus recent finished threads from the state DB. */
export async function codexSessions({ tabs, sinceMs }: SourceOptions): Promise<SessionInput[]> {
  const threads = readCodexThreads();
  const processes = await findCodexProcesses();
  const threadById = new Map(threads.map((t) => [t.id, t]));
  const liveThreadIds = new Set(processes.map((p) => p.threadId).filter((id): id is string => !!id && threadById.has(id)));
  const inactive = threads.filter((t) => !liveThreadIds.has(t.id) && t.updated_at * SECOND >= sinceMs);

  const [info, liveGit, inactiveGit] = await Promise.all([
    processInfo(processes.map((p) => p.pid)),
    Promise.all(processes.map((p) => gitInfo(p.cwd))),
    Promise.all(inactive.map((t) => gitInfo(t.cwd))),
  ]);

  const live = processes.map((proc, i) => {
    const thread = proc.threadId ? threadById.get(proc.threadId) : undefined;
    const procInfo = info.get(proc.pid);
    return thread ? liveSession(proc, thread, liveGit[i], procInfo?.tty) : freshSession(proc, liveGit[i], procInfo, tabs);
  });
  const finished = inactive.map((thread, i) => inactiveSession(thread, inactiveGit[i]));
  return [...live, ...finished];
}

function liveSession(proc: CodexProcess, thread: CodexThread, git: GitInfo, tty: string | undefined): SessionInput {
  const rollout = summarizeRollout(thread.rollout_path);
  return {
    tool: "codex",
    id: thread.id,
    pid: proc.pid,
    status: rollout.status,
    cwd: proc.cwd,
    ...git,
    title: collapse(thread.title, TITLE_MAX_LENGTH) || thread.id.slice(0, 8),
    firstPrompt: thread.first_user_message || undefined,
    lastPrompt: rollout.prompts.at(-1),
    lastPromptAt: rollout.lastPromptAt,
    completedAt: rollout.status === "idle" ? rollout.at : undefined,
    prompts: rollout.prompts,
    since: rollout.at,
    tty,
  };
}

/** A `codex` that has not sent its first message yet, so no thread exists for it. */
function freshSession(proc: CodexProcess, git: GitInfo, info: ProcessInfo | undefined, tabs: TerminalTabs): SessionInput {
  const tty = info?.tty;
  const tabTitle = tty ? tabs.get(tty)?.title.trim() : undefined;
  const hasCustomTitle = tabTitle && tabTitle !== basename(proc.cwd);
  return {
    tool: "codex",
    id: proc.threadId ?? `pid-${proc.pid}`,
    pid: proc.pid,
    status: "idle",
    cwd: proc.cwd,
    ...git,
    title: hasCustomTitle ? tabTitle : "new session, no messages yet",
    prompts: [],
    since: info?.startedAt ?? Date.now(),
    tty,
  };
}

function inactiveSession(thread: CodexThread, git: GitInfo): SessionInput {
  return {
    tool: "codex",
    id: thread.id,
    status: "inactive",
    cwd: thread.cwd,
    ...git,
    ...(thread.git_branch ? { branch: thread.git_branch } : {}),
    title: collapse(thread.title, TITLE_MAX_LENGTH) || thread.id.slice(0, 8),
    firstPrompt: thread.first_user_message || undefined,
    prompts: thread.first_user_message ? [collapse(thread.first_user_message, PROMPT_MAX_LENGTH)] : [],
    since: thread.updated_at * SECOND,
  };
}
