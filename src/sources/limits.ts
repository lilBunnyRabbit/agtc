import { MINUTE } from "../lib/time";

/** How far back a log is read for the last message; a long report with its tool calls fits. */
export const REPORT_TAIL_BYTES = 512 * 1024;
/** A finished child stays in the graph this long: long enough to see the hand-back land. */
export const SUBAGENT_RECENT_MS = 10 * MINUTE;
