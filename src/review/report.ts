import { collapse } from "../lib/text";
import type { Session, Verdict } from "../model/session";
import { lastAssistantMessage } from "../sources/claude/transcript";
import { lastAgentMessage } from "../sources/codex/rollout";
import { readCodexThreads } from "../sources/codex/threads";

export function reviewerReport(session: Session): string | undefined {
  if (session.tool === "claude") return lastAssistantMessage(session.id, session.cwd);
  const thread = readCodexThreads().find((t) => t.id === session.id);
  return thread ? lastAgentMessage(thread.rollout_path) : undefined;
}

const VERDICT_MAX_LENGTH = 80;
const verdicts = new Map<string, { at: number; verdict: Verdict | undefined }>();

/** The first bullet under `## Verdict`; "not ready" anywhere in it wins over "ready". */
export function parseVerdict(report: string): Verdict | undefined {
  const section = report.split(/^##\s+Verdict\s*$/im)[1];
  const line = section?.split("\n").map((l) => l.replace(/^[-*]\s*/, "").trim()).find(Boolean);
  if (!line) return undefined;
  const text = collapse(line, VERDICT_MAX_LENGTH);
  return { ready: !/not\s+ready/i.test(text) && /^ready\b/i.test(text), text };
}

/** A report only changes when a turn finishes, so `since` is the cache key. */
export function reviewerVerdict(session: Session): Verdict | undefined {
  if (session.status === "busy" || session.status === "needs input") return undefined;
  const cached = verdicts.get(session.id);
  if (cached && cached.at === session.since) return cached.verdict;
  const report = reviewerReport(session);
  const verdict = report ? parseVerdict(report) : undefined;
  verdicts.set(session.id, { at: session.since, verdict });
  return verdict;
}

export function reportMessage(reviewer: Session, report: string): string {
  return `Review findings from a ${reviewer.tool} reviewer that saw only the spec and the diff, not this conversation:\n\n${report}\n`;
}
