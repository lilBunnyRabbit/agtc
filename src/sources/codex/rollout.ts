import { parseJsonLine, readTailLines } from "../../lib/files";
import { collapse } from "../../lib/text";
import { PROMPT_MAX_LENGTH, type Status } from "../../session";

export interface RolloutSummary {
  status: Status;
  /** When that status began. */
  at: number;
  /** Prompts found in the tail of the log, oldest first. */
  prompts: string[];
  lastPromptAt?: number;
}

interface RolloutEvent {
  timestamp?: string;
  payload?: { type?: string; message?: unknown; last_agent_message?: unknown };
}

/** How far back a rollout is read for the last message; a long report with its tool calls fits. */
const REPORT_TAIL_BYTES = 512 * 1024;

/** Current status and recent prompts from the tail of a thread's rollout .jsonl. */
export function summarizeRollout(path: string): RolloutSummary {
  const prompts: string[] = [];
  let lastPromptAt: number | undefined;
  let sawOutput = false;
  let outcome: { status: Status; at: number } | undefined;

  // Newest event first: the first status-bearing event is the current state.
  for (const line of readTailLines(path).reverse()) {
    const event = parseJsonLine<RolloutEvent>(line);
    if (!event) continue;
    const at = event.timestamp ? Date.parse(event.timestamp) : Date.now();
    const type = event.payload?.type ?? "";

    if (type === "user_message" && typeof event.payload?.message === "string") {
      prompts.unshift(collapse(event.payload.message, PROMPT_MAX_LENGTH));
      lastPromptAt ??= at;
    }
    if (outcome) continue;

    if (type.endsWith("_output") || type === "item_completed") sawOutput = true;
    // An approval request that already produced output was answered.
    if (type.includes("approval_request")) outcome = { status: sawOutput ? "busy" : "needs input", at };
    else if (type === "task_complete" || type === "turn_aborted") outcome = { status: "idle", at };
    else if (type === "task_started") outcome = { status: "busy", at };
  }

  return { ...(outcome ?? { status: "idle", at: Date.now() }), prompts, lastPromptAt };
}

/** The agent's last complete message, as the turn's `task_complete` recorded it. Nothing while a turn is under way. */
export function lastAgentMessage(path: string): string | undefined {
  for (const line of readTailLines(path, REPORT_TAIL_BYTES).reverse()) {
    const type = parseJsonLine<RolloutEvent>(line)?.payload?.type;
    if (type === "task_started") return undefined;
    if (type !== "task_complete") continue;
    const message = parseJsonLine<RolloutEvent>(line)?.payload?.last_agent_message;
    return typeof message === "string" && message.trim() ? message.trim() : undefined;
  }
  return undefined;
}
