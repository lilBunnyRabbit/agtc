import type { Session, Status } from "../model/session";
import { Key } from "./keys";
import type { UiState } from "./render";

/** What a key needs to know of a row. The popup has this much of the session and no more. */
export interface Row {
  status: Status;
  reviewer: boolean;
  inTmux: boolean;
}

export type Section = "list" | "jump" | "act" | "review" | "look";

/** One key of the hub, described once: the footer, the `?` reference and the pane popup all read this. What the key does is in the app. */
export interface KeyAction {
  key: string;
  shown?: string;
  label: string;
  /** The footer's label while it depends on what is on screen. */
  state?: (ui: UiState) => string;
  help: string;
  also?: string;
  section: Section;
  /** In the footer without `?`: a key for the selected row. */
  hint?: boolean;
  applies?: (row: Row) => boolean;
  opensPopup?: boolean;
}

const live = ({ status }: Row) => status !== "inactive";
const onOff = (flag: boolean) => (flag ? "on" : "off");

export const ACTIONS: KeyAction[] = [
  { key: "j", shown: "j ↑", label: "up", section: "list", help: "move the selection up, inactive rows included" },
  { key: "k", shown: "k ↓", label: "down", section: "list", help: "move the selection down, inactive rows included" },
  { key: "g", label: "top", section: "list", help: "the first row" },
  { key: "G", label: "bottom", section: "list", help: "the last row" },
  {
    key: "/",
    label: "search",
    state: (ui) => `search${ui.query ? " (esc clears)" : ""}`,
    section: "list",
    hint: true,
    help: "search every prompt ever typed, plus worktree, branch, path, tool, status",
    also: "esc clears",
  },
  { key: "J", label: "agent above", section: "jump", help: "the running session above, selected and staged", also: "option-j from any pane" },
  { key: "K", label: "agent below", section: "jump", help: "the running session below, selected and staged", also: "option-k from any pane" },
  {
    key: "1",
    shown: "1-9",
    label: "agent that waits",
    section: "jump",
    help: "the session with that digit, staged; only one that is done or needs input has a digit",
    also: "option-1 … option-9 from any pane",
  },
  {
    key: Key.enter,
    shown: "enter",
    label: "stage",
    state: (ui) => ui.enterHint,
    section: "jump",
    hint: true,
    applies: live,
    help: "stage the selected session (with --jump zed: open its checkout in the editor)",
  },
  { key: "R", label: "resume in tmux", section: "act", hint: true, applies: (row) => !live(row), help: "resume an inactive session in a tmux window", also: "a reviewer comes back read-only" },
  { key: "m", label: "mark seen", section: "look", hint: true, applies: ({ status }) => status === "done", help: "mark the selected session as seen" },
  { key: "c", label: "copy resume", section: "act", hint: true, help: "copy its resume command" },
  { key: "o", label: "editor", section: "act", hint: true, help: "open its checkout in the editor at the last changed file", also: "AGTC_EDITOR, default zed" },
  {
    key: "e",
    label: "vscode",
    section: "act",
    hint: true,
    help: "show its checkout in the agtc VS Code window and link the agent with /ide",
    also: "from the agent's own pane: prefix space, then e",
  },
  { key: "v", label: "diff", section: "act", hint: true, opensPopup: true, help: "lazygit over its checkout in a popup", also: "git diff HEAD without lazygit" },
  {
    key: "V",
    label: "review",
    section: "review",
    hint: true,
    opensPopup: true,
    applies: ({ reviewer }) => !reviewer,
    help: "start a read-only reviewer in a pane beside the session's. Spec: tab walks the spec it wrote, ask <tool> for a spec, first / last prompt; or type text or @file. Then the reviewing tool",
  },
  {
    key: "V",
    label: "paste report",
    section: "review",
    hint: true,
    applies: ({ reviewer }) => reviewer,
    help: "paste the reviewer's report into the reviewed session's input, unsent; read it there, then enter",
  },
  { key: "x", label: "close", section: "review", hint: true, applies: (row) => row.reviewer && live(row), help: "close it", also: "refused while its report is unread: V or m first" },
  {
    key: "X",
    label: "close",
    section: "act",
    hint: true,
    opensPopup: true,
    applies: (row) => !row.reviewer && live(row) && row.inTmux,
    help: "close it: the agent and its tmux window, reviewers beside it included",
    also: "asks y/N first, then whether its worktree goes too when that is clean; R brings it back",
  },
  {
    key: "n",
    label: "new agent",
    section: "act",
    hint: true,
    opensPopup: true,
    help: "another agent of the same kind; asks where, tab walks the checkouts",
    also: "option-n from any pane, which asks in a popup there",
  },
  { key: "N", label: "new worktree", section: "act", hint: true, help: "a new worktree of its repository, then an agent in it; asks for the branch" },
  { key: "S", label: "restore hub", section: "act", help: "restore every agent window of the last hub", also: "reviewers read-only" },
  { key: "M", label: "mark all seen", section: "look", help: "mark every session as seen" },
  { key: "r", label: "refresh", section: "look", help: "refresh now" },
  { key: "a", label: "inactive", state: (ui) => `inactive:${onOff(ui.showInactive)}`, section: "look", help: "inactive sessions on / off" },
  { key: "d", label: "detail", state: (ui) => `detail:${onOff(ui.showDetail)}`, section: "look", help: "detail pane on / off" },
  { key: "q", label: "quit", section: "look", help: "quit agtc, agents keep running" },
  { key: "?", label: "keys", state: (ui) => (ui.showKeys ? "less" : "keys"), section: "look", hint: true, help: "this reference" },
];

export const rowOf = ({ status, reviewOf, tmux }: Session): Row => ({ status, reviewer: !!reviewOf, inTmux: !!tmux });

export const appliesTo = (row: Row) => (action: KeyAction) => action.applies?.(row) ?? true;

export const shownKey = ({ key, shown }: KeyAction) => shown ?? key;
