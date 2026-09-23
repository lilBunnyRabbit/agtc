import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import pkg from "../package.json";
import { padRight } from "./lib/text";
import { HELP_FILE } from "./paths";
import { STATUSES, type Status } from "./session";
import { ANSI, stripAnsi, style, visibleLength } from "./tui/ansi";
import { ICON, STATUS_LABEL, needsAttention, statusStyle, toolIcon, worktreeIcon } from "./tui/theme";

const KEY_WIDTH = 20;

const heading = (text: string) => style(text, ANSI.bold, ANSI.cyan);
const k = (text: string) => style(text, ANSI.bold, ANSI.yellow);
/** Key column in yellow unless it brings its own colours (a glyph, a badge); padding counts visible columns. */
const key = (keys: string, what: string, also = "") =>
  `  ${keys === stripAnsi(keys) ? k(keys) : keys}${" ".repeat(Math.max(1, KEY_WIDTH - visibleLength(keys)))}${what}${also ? style(`   ${also}`, ANSI.dim) : ""}`;
const note = (text: string) => `  ${style(text, ANSI.dim)}`;
const child = style(ICON.child, ANSI.cyan);
const onReview = (keys: string) => `${k(`${keys} on `)}${child}${k(" review")}`;

/** A status as the list draws it: filled badge when it wants you, plain colour otherwise. */
function badge(status: Status): string {
  const label = STATUS_LABEL[status];
  return needsAttention(status) ? style(` ${label} `, ...statusStyle(status), ANSI.reverse) : style(label, ...statusStyle(status));
}

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
    key("J / K", "the running session above / below, selected and staged", "option-j / option-k from any pane"),
    key("1 … 9", "the running session with that digit, staged", "option-1 … option-9 from any pane"),
    key("enter", "stage the selected session (with --jump zed: open its checkout in the editor)"),
    key("option-a, prefix a", "back to agtc from any pane"),
    key("j / k  ↑ ↓", "move the selection up / down only, inactive rows included"),
    key("g / G", "top / bottom"),
    key("/", "search every prompt ever typed, plus worktree, branch, path, tool, status", "esc clears"),
    "",
    heading("Look"),
    key("d", "detail pane on / off"),
    key("a", "inactive sessions on / off"),
    key("m / M", "mark the selected / every session as seen"),
    key("r", "refresh now"),
    key("?", "this reference"),
    key("q", "quit agtc, agents keep running"),
    "",
    heading("Act on the selected session"),
    key("o", "open its checkout in the editor at the last changed file", "AGTC_EDITOR, default zed"),
    key("v", "lazygit over its checkout in a popup", "git diff HEAD without lazygit"),
    key("n", "another agent of the same kind; asks where, tab walks the checkouts"),
    key("N", "a new worktree of its repository, then an agent in it; asks for the branch"),
    key("R", "resume an inactive session in a tmux window"),
    key("S", "restore every agent window of the last hub"),
    key("c", "copy its resume command"),
    "",
    heading("Review loop"),
    key("V", "start a read-only reviewer in a pane beside the session's. Spec: tab walks the spec it wrote, ask <tool> for a spec, first / last prompt; or type text or @file. Then the reviewing tool"),
    key(onReview("V"), "paste the reviewer's report into the reviewed session's input, unsent; read it there, then enter"),
    key("f", "the reviewer's report in a popup, on its row or the reviewed session's; q then a finding's number opens that file:line in the editor"),
    key(onReview("enter"), "see what it says, answer its questions"),
    key(onReview("x"), "close it", "refused while its report is unread: V, f or m first"),
    note(`One round: V, ask for a spec, enter in the agent, V again, pick the tool, wait, f to read, V on ${ICON.child} review, enter in the agent. Then v to commit, and tell the agent to push.`),
    "",
    heading("Rows"),
    key(`${toolIcon("claude")}  ${toolIcon("codex")}`, "Claude Code, Codex"),
    key(worktreeIcon(), "the session lives in a git worktree"),
    key(`${child}${k(" review")}`, "a reviewer of the row above; its digit stages it like any other"),
    ...STATUSES.map((status) => key(badge(status), STATUS_MEANING[status])),
    "",
    heading("tmux"),
    key("prefix z", "zoom the stage to the whole window, again to unzoom"),
    key("prefix space", "flip the hub between side by side and stacked"),
    key("prefix w", "every window, pick one; prefix n / p next / previous"),
    key("drag the border", "resize the stage; --stage sets the starting width"),
    note("prefix is ctrl-b unless you changed it. option keys need the terminal to send option as meta."),
    "",
  ].join("\n");
}

/** Writes the reference where the popup's pager reads it. */
export function writeHelp(): string {
  mkdirSync(dirname(HELP_FILE), { recursive: true });
  writeFileSync(HELP_FILE, helpText());
  return HELP_FILE;
}
