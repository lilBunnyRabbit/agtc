export type Tool = "claude" | "codex";
export type Status = "needs input" | "done" | "busy" | "idle" | "inactive";

/** Display order, most urgent first. */
export const STATUSES: Status[] = ["needs input", "done", "busy", "idle", "inactive"];

/** Sort rank: the more a session needs you, the lower the number. */
export const STATUS_PRIORITY: Record<Status, number> = Object.fromEntries(STATUSES.map((s, i) => [s, i])) as Record<Status, number>;

export const TITLE_MAX_LENGTH = 120;
export const PROMPT_MAX_LENGTH = 1000;

/** One agent session as produced by a source, before search text is attached. */
export interface SessionInput {
  tool: Tool;
  /** Claude session id or Codex thread id. */
  id: string;
  pid?: number;
  status: Status;
  /** What a "needs input" session is blocked on, when known. */
  waitingFor?: string;
  cwd: string;
  /** Repository name: the main checkout's directory name. */
  repo: string;
  /** Directory name of the linked worktree, when cwd is one. */
  worktree?: string;
  branch?: string;
  title: string;
  firstPrompt?: string;
  lastPrompt?: string;
  lastPromptAt?: number;
  /** When the last turn finished. Only set while idle; drives the "done" state. */
  completedAt?: number;
  /** Every prompt sent in this session, oldest first. */
  prompts: string[];
  /** When the current status began. Last activity for inactive sessions. */
  since: number;
  /** Controlling terminal, e.g. "ttys004". Links the session to a Terminal.app tab. */
  tty?: string;
}

export interface Session extends SessionInput {
  /** Lower-cased haystack for `/` search: title, prompts, paths, branch, status. */
  searchText: string;
}

/** Single-quotes a string for a POSIX shell, so nothing inside it expands when pasted. */
const shellQuote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;

/** The command to pick this session up again in a fresh terminal. Copied, never run. */
export function resumeCommand(session: Session): string {
  const cd = `cd ${shellQuote(session.cwd)}`;
  const id = shellQuote(session.id);
  return session.tool === "claude" ? `${cd} && claude --resume ${id}` : `${cd} && codex resume ${id}`;
}
