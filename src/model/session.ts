import type { GitChanges } from "../sources/git";
import type { TmuxLocation } from "../sources/types";
import type { Tool } from "./tools";

export type { Tool } from "./tools";
export { TOOLS, isTool, resumeCommand, resumeInvocation } from "./tools";

export type Status = "needs input" | "done" | "busy" | "idle" | "inactive";

export const STATUSES: Status[] = ["needs input", "done", "busy", "idle", "inactive"];
export const STATUS_PRIORITY: Record<Status, number> = Object.fromEntries(STATUSES.map((s, i) => [s, i])) as Record<Status, number>;

export const TITLE_MAX_LENGTH = 120;
export const PROMPT_MAX_LENGTH = 1000;

export interface SessionInput {
  tool: Tool;
  id: string;
  pid?: number;
  status: Status;
  waitingFor?: string;
  cwd: string;
  root?: string;
  mainRoot?: string;
  /** Every checkout the session has edited files in, the current one first. */
  roots: string[];
  repo: string;
  worktree?: string;
  branch?: string;
  changes?: GitChanges;
  title: string;
  firstPrompt?: string;
  lastPrompt?: string;
  lastPromptAt?: number;
  /** When the last turn finished. Only set while idle; drives the "done" state. */
  completedAt?: number;
  prompts: string[];
  /** When the current status began. Last activity for inactive sessions. */
  since: number;
  /** Live sessions only; fixes their place in the list. */
  startedAt?: number;
  tty?: string;
  tmux?: TmuxLocation;
  viewed?: boolean;
  reviewOf?: string;
  /** What a finished reviewer concluded, from the `## Verdict` section of its report. */
  verdict?: Verdict;
  subagents?: Subagent[];
}

export interface Verdict {
  ready: boolean;
  text: string;
}

export interface Subagent {
  id: string;
  description: string;
  kind?: string;
  status: "busy" | "done";
  since: number;
}

export interface Session extends SessionInput {
  searchText: string;
}

export const workDir = (session: Pick<SessionInput, "root" | "cwd">) => session.root ?? session.cwd;
