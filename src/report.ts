import type { Session } from "./session";
import { lastAssistantMessage } from "./sources/claude/transcript";
import { lastAgentMessage } from "./sources/codex/rollout";
import { readCodexThreads } from "./sources/codex/threads";

/** What a reviewer said last, complete turns only, read from its own log. */
export function reviewerReport(session: Session): string | undefined {
  if (session.tool === "claude") return lastAssistantMessage(session.id, session.cwd);
  const thread = readCodexThreads().find((t) => t.id === session.id);
  return thread ? lastAgentMessage(thread.rollout_path) : undefined;
}

/** The report as it lands in the reviewed session's input: who it is from, then the text. */
export function reportMessage(reviewer: Session, report: string): string {
  return `Review findings from a ${reviewer.tool} reviewer that saw only the spec and the diff, not this conversation:\n\n${report}\n`;
}
