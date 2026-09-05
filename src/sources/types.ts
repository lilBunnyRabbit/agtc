import type { TerminalTabs } from "./terminal";

export interface SourceOptions {
  tabs: TerminalTabs;
  /** Inactive sessions older than this timestamp are dropped. */
  sinceMs: number;
}
