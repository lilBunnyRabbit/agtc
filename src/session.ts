import { shellQuote } from "./lib/shell";
import { readOnlyFlags } from "./review";
import type { GitChanges } from "./sources/git";
import type { TmuxLocation } from "./sources/types";

export type Tool = "claude" | "codex";
export const TOOLS: Tool[] = ["claude", "codex"];
export const isTool = (value: string): value is Tool => (TOOLS as string[]).includes(value);
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
  /** Where the session started. */
  cwd: string;
  /** Top level of the checkout the session works in. Absent outside git. */
  root?: string;
  /** The repository's main checkout. Absent outside git. */
  mainRoot?: string;
  /** Every checkout the session has edited files in, the current one first. */
  roots: string[];
  /** Repository name: the main checkout's directory name. */
  repo: string;
  /** Directory name of the linked worktree, when `root` is one. */
  worktree?: string;
  branch?: string;
  changes?: GitChanges;
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
  /** When the process started. Live sessions only; fixes their place in the list. */
  startedAt?: number;
  /** Controlling terminal, e.g. "ttys004". Links the session to a Terminal.app tab or tmux pane. */
  tty?: string;
  /** Set when the tty is a tmux pane. */
  tmux?: TmuxLocation;
  /** Its terminal is on screen right now: the Terminal.app tab in front, or a tmux window a client shows. */
  viewed?: boolean;
  /** Id of the session this one reviews, for a reviewer started with `V`. */
  reviewOf?: string;
}

export interface Session extends SessionInput {
  /** Lower-cased haystack for `/` search: title, prompts, paths, branch, status. */
  searchText: string;
}

/** Directory to open, diff or start another agent in. */
export const workDir = (session: SessionInput) => session.root ?? session.cwd;

/** The tool's own resume invocation, to run inside the session's cwd. A reviewer comes back as read-only as it started. */
export function resumeInvocation(session: Pick<Session, "tool" | "id" | "reviewOf">): string {
  const id = shellQuote(session.id);
  const flags = session.reviewOf ? ` ${readOnlyFlags(session.tool)}` : "";
  return session.tool === "claude" ? `claude --resume ${id}${flags}` : `codex resume${flags} ${id}`;
}

/** The command to pick this session up again in a fresh terminal. Copied, never run. */
export function resumeCommand(session: Session): string {
  return `cd ${shellQuote(session.cwd)} && ${resumeInvocation(session)}`;
}
