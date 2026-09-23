import type { Status, Tool } from "../session";
import { ANSI, style } from "./ansi";

export const ICON = {
  claude: "✳",
  codex: "⬡",
  worktree: "⎇",
  mainCheckout: "⌂",
  search: "⌕",
  review: "⌖",
  selection: "▌",
  lastPrompt: "↳",
  rule: "─",
} as const;

/** Short status word for the list column. */
export const STATUS_LABEL: Record<Status, string> = {
  "needs input": "input",
  done: "done",
  busy: "busy",
  idle: "idle",
  inactive: "inactive",
};

/** Statuses that want you: shown as a filled badge with the title in the same colour. */
export const needsAttention = (status: Status) => status === "needs input" || status === "done";

export function statusStyle(status: Status): string[] {
  switch (status) {
    case "needs input":
      return [ANSI.magenta, ANSI.bold];
    case "done":
      return [ANSI.blue, ANSI.bold];
    case "busy":
      return [ANSI.yellow];
    case "idle":
      return [ANSI.green];
    case "inactive":
      return [ANSI.dim];
  }
}

export function toolIcon(tool: Tool, dimmed = false): string {
  const color = dimmed ? ANSI.dim : tool === "claude" ? ANSI.yellow : ANSI.white;
  return style(ICON[tool], color);
}

export function worktreeIcon(dimmed = false): string {
  return style(ICON.worktree, dimmed ? ANSI.dim : ANSI.cyan);
}
