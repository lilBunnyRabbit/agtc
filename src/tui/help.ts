import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import pkg from "../../package.json";
import { padRight } from "../lib/text";
import { HELP_FILE } from "../paths";
import { STATUSES, type Status } from "../model/session";
import { ACTIONS, type Section, shownKey } from "./actions";
import { ANSI, stripAnsi, style, visibleLength } from "./ansi";
import { ICON, STATUS_LABEL, needsAttention, statusStyle, toolIcon, worktreeIcon } from "./theme";

const KEY_WIDTH = 20;

const heading = (text: string) => style(text, ANSI.bold, ANSI.cyan);
const k = (text: string) => style(text, ANSI.bold, ANSI.yellow);
/** Key column in yellow unless it brings its own colours (a glyph, a badge); padding counts visible columns. */
const key = (keys: string, what: string, also = "") =>
  `  ${keys === stripAnsi(keys) ? k(keys) : keys}${" ".repeat(Math.max(1, KEY_WIDTH - visibleLength(keys)))}${what}${also ? style(`   ${also}`, ANSI.dim) : ""}`;
const note = (text: string) => `  ${style(text, ANSI.dim)}`;
const child = style(ICON.child, ANSI.cyan);
const onReview = (keys: string) => `${k(`${keys} on `)}${child}${k(" review")}`;

function badge(status: Status): string {
  const label = STATUS_LABEL[status];
  return needsAttention(status) ? style(` ${label} `, ...statusStyle(status), ANSI.reverse) : style(label, ...statusStyle(status));
}

const agentRow = { status: "idle", reviewer: false, inTmux: true } as const;

/** A key that only a reviewer's row has is shown as such. */
const keysOf = (section: Section) =>
  ACTIONS.filter((action) => action.section === section).map((action) => {
    const onReviewer = action.applies && !action.applies(agentRow) && action.applies({ ...agentRow, reviewer: true });
    return key(onReviewer ? onReview(shownKey(action)) : shownKey(action), action.help, action.also);
  });

const STATUS_MEANING: Record<Status, string> = {
  "needs input": "blocked on a permission or dialog",
  done: "turn finished after your last prompt, output not looked at yet",
  busy: "working",
  idle: "waiting for you, output already seen",
  inactive: "not running; a shows them, R resumes one",
};

/** The whole key reference, for the `?` popup. Sections follow what you are doing, not the keyboard. */
export function helpText(): string {
  return [
    `${style("agtc", ANSI.bold)} ${style(pkg.version, ANSI.dim)}   ${style("keys", ANSI.bold)}${style("   q or ctrl-c closes this, ↑↓ scroll", ANSI.dim)}`,
    "",
    heading("Move between agents"),
    ...keysOf("jump"),
    key("option-a, prefix a", "back to agtc from any pane"),
    "",
    heading("From the agent's own pane"),
    key("prefix space", "a popup over the pane: which session it is, its checkout, and the keys below", "option-space too"),
    note("V X n ask in a popup over the pane. A digit takes you to the agent listed under it, one that waits for you. esc or q closes it."),
    "",
    heading("Move in the list"),
    ...keysOf("list"),
    "",
    heading("Look"),
    ...keysOf("look"),
    "",
    heading("Act on the selected session"),
    ...keysOf("act"),
    "",
    heading("Review loop"),
    ...keysOf("review"),
    key(onReview("enter"), "see what it says, answer its questions"),
    note(`One round: V, ask for a spec, enter in the agent, V again, pick the tool, wait, V on ${ICON.child} review, enter in the agent. Then v to commit, and tell the agent to push.`),
    "",
    heading("Rows"),
    key(`${toolIcon("claude")}  ${toolIcon("codex")}`, "Claude Code, Codex"),
    key(worktreeIcon(), "the session lives in a git worktree"),
    key(style(" vscode ", ANSI.cyan, ANSI.bold, ANSI.reverse), "the agtc VS Code window shows this session's checkout"),
    key(`${child}${k(" review")}`, "a reviewer of the row above; once done it gets a digit like any other"),
    key(style(ICON.subagent, ANSI.cyan), "in agtc graph: an agent the session spawned inside itself, busy or just done"),
    ...STATUSES.map((status) => key(badge(status), STATUS_MEANING[status])),
    "",
    heading("Mouse"),
    key("click", "select the row"),
    key("double click", "stage it, like enter"),
    key("wheel", "move the selection"),
    "",
    heading("tmux"),
    key("prefix z", "zoom the stage to the whole window, again to unzoom"),
    key("prefix space space", "flip the hub between side by side and stacked", "the popup took prefix space"),
    key("prefix w", "every window, pick one; prefix n / p next / previous"),
    key("drag the border", "resize the stage; --stage sets the starting width"),
    note("prefix is ctrl-b unless you changed it. option keys need the terminal to send option as meta."),
    "",
  ].join("\n");
}

export function writeHelp(): string {
  mkdirSync(dirname(HELP_FILE), { recursive: true });
  writeFileSync(HELP_FILE, helpText());
  return HELP_FILE;
}
