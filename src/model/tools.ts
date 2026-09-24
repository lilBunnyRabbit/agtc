import { shellQuote } from "../lib/shell";

export type Tool = "claude" | "codex";
export const TOOLS: Tool[] = ["claude", "codex"];
export const isTool = (value: string): value is Tool => (TOOLS as string[]).includes(value);

/** The other tool by default: a fresh process of another model shares nothing with the author, not even memory. */
export const reviewerFor = (tool: Tool): Tool => (tool === "claude" ? "codex" : "claude");

const CLAUDE_READ_TOOLS = ["Read", "Grep", "Glob", "Bash(git diff:*)", "Bash(git log:*)", "Bash(git show:*)", "Bash(git status:*)", "Bash(git blame:*)"];
const CLAUDE_WRITE_TOOLS = ["Edit", "Write", "NotebookEdit", "Read(~/.claude/**)", "Read(~/.codex/**)"];

export function readOnlyFlags(tool: Tool): string {
  if (tool === "codex") return "--sandbox read-only --ask-for-approval never";
  return `--disallowedTools ${shellQuote(CLAUDE_WRITE_TOOLS.join(","))} --allowedTools ${shellQuote(CLAUDE_READ_TOOLS.join(","))}`;
}

export function resumeInvocation(session: { tool: Tool; id: string; reviewOf?: string }): string {
  const id = shellQuote(session.id);
  const flags = session.reviewOf ? ` ${readOnlyFlags(session.tool)}` : "";
  return session.tool === "claude" ? `claude --resume ${id}${flags}` : `codex resume${flags} ${id}`;
}

export function resumeCommand(session: { tool: Tool; id: string; cwd: string; reviewOf?: string }): string {
  return `cd ${shellQuote(session.cwd)} && ${resumeInvocation(session)}`;
}
