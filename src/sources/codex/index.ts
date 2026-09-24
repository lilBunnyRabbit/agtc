import { basename } from "node:path";
import { collapse } from "../../lib/text";
import { SECOND } from "../../lib/time";
import { PROMPT_MAX_LENGTH, type SessionInput, type Subagent, TITLE_MAX_LENGTH } from "../../model/session";
import { type GitInfo, gitInfo } from "../git";
import { type ProcessInfo, processInfo } from "../processes";
import { SUBAGENT_RECENT_MS } from "../limits";
import type { SourceOptions, Surfaces } from "../types";
import { type CodexProcess, findCodexProcesses } from "./processes";
import { summarizeRollout } from "./rollout";
import { type CodexThread, readCodexThreads, readSpawnedThreads } from "./threads";

export async function codexSessions({ surfaces, sinceMs }: SourceOptions): Promise<SessionInput[]> {
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
    return thread ? liveSession(proc, thread, liveGit[i], procInfo, surfaces) : freshSession(proc, liveGit[i], procInfo, surfaces);
  });
  const finished = inactive.map((thread, i) => inactiveSession(thread, inactiveGit[i]));
  return [...live, ...finished];
}

const rootsOf = (git: GitInfo) => (git.root ? [git.root] : []);

function liveSession(proc: CodexProcess, thread: CodexThread, git: GitInfo, info: ProcessInfo | undefined, surfaces: Surfaces): SessionInput {
  const tty = info?.tty;
  const rollout = summarizeRollout(thread.rollout_path);
  return {
    tool: "codex",
    id: thread.id,
    pid: proc.pid,
    status: rollout.status,
    cwd: proc.cwd,
    ...git,
    roots: rootsOf(git),
    title: collapse(thread.title, TITLE_MAX_LENGTH) || thread.id.slice(0, 8),
    firstPrompt: thread.first_user_message || undefined,
    lastPrompt: rollout.prompts.at(-1),
    lastPromptAt: rollout.lastPromptAt,
    completedAt: rollout.status === "idle" ? rollout.at : undefined,
    prompts: rollout.prompts,
    since: rollout.at,
    startedAt: info?.startedAt,
    tty,
    tmux: tty ? surfaces.get(tty)?.tmux : undefined,
    subagents: spawnedAgents(thread.id),
  };
}

/** Collaborators a thread spawned, running or just finished. Their prompts are encrypted on disk, so the nickname and role name them. */
function spawnedAgents(threadId: string): Subagent[] {
  const now = Date.now();
  return readSpawnedThreads(threadId).flatMap((child): Subagent[] => {
    const rollout = summarizeRollout(child.rollout_path);
    const status = rollout.status === "busy" || rollout.status === "needs input" ? "busy" : "done";
    if (status === "done" && now - rollout.at > SUBAGENT_RECENT_MS) return [];
    const kind = child.agent_role || (child.agent_path ? basename(child.agent_path) : undefined) || undefined;
    return [{ id: child.id, description: child.agent_nickname || collapse(child.title, TITLE_MAX_LENGTH) || child.id.slice(0, 8), kind, status, since: rollout.at }];
  });
}

/** A `codex` that has not sent its first message yet, so no thread exists for it. */
function freshSession(proc: CodexProcess, git: GitInfo, info: ProcessInfo | undefined, surfaces: Surfaces): SessionInput {
  const tty = info?.tty;
  const surface = tty ? surfaces.get(tty) : undefined;
  const tabTitle = surface?.title.trim();
  const hasCustomTitle = tabTitle && tabTitle !== basename(proc.cwd);
  return {
    tool: "codex",
    id: proc.threadId ?? `pid-${proc.pid}`,
    pid: proc.pid,
    status: "idle",
    cwd: proc.cwd,
    ...git,
    roots: rootsOf(git),
    title: hasCustomTitle ? tabTitle : "new session, no messages yet",
    prompts: [],
    since: info?.startedAt ?? Date.now(),
    startedAt: info?.startedAt,
    tty,
    tmux: surface?.tmux,
  };
}

function inactiveSession(thread: CodexThread, git: GitInfo): SessionInput {
  return {
    tool: "codex",
    id: thread.id,
    status: "inactive",
    cwd: thread.cwd,
    ...git,
    roots: rootsOf(git),
    ...(thread.git_branch ? { branch: thread.git_branch } : {}),
    title: collapse(thread.title, TITLE_MAX_LENGTH) || thread.id.slice(0, 8),
    firstPrompt: thread.first_user_message || undefined,
    prompts: thread.first_user_message ? [collapse(thread.first_user_message, PROMPT_MAX_LENGTH)] : [],
    since: thread.updated_at * SECOND,
  };
}
