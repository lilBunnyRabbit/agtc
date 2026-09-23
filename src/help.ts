import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import pkg from "../package.json";
import { padRight } from "./lib/text";
import { HELP_FILE } from "./paths";
import { ANSI, style } from "./tui/ansi";

const KEY_WIDTH = 20;

const heading = (text: string) => style(text, ANSI.bold, ANSI.cyan);
const key = (keys: string, what: string, also = "") => `  ${style(padRight(keys, KEY_WIDTH), ANSI.bold)}${what}${also ? style(`   ${also}`, ANSI.dim) : ""}`;
const note = (text: string) => `  ${style(text, ANSI.dim)}`;

/** The whole key reference, for the `?` popup. Sections follow what you are doing, not the keyboard. */
export function helpText(): string {
  return [
    `${style("agtc", ANSI.bold)} ${style(pkg.version, ANSI.dim)}   ${style("keys", ANSI.bold)}${style("   q closes this", ANSI.dim)}`,
    "",
    heading("Move between agents"),
    key("j / k", "next / previous running session, selected and staged", "option-j / option-k from any pane"),
    key("1 … 9", "the running session with that digit, staged", "option-1 … option-9 from any pane"),
    key("enter", "stage the selected session (with --jump zed: open its checkout in the editor)"),
    key("option-a, prefix a", "back to agtc from any pane"),
    key("↑ ↓  J / K", "move the selection only, inactive rows included"),
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
    key("V", "start a read-only reviewer. Spec: tab walks the spec it wrote, ask <tool> for a spec, first / last prompt; or type text or @file. Then the reviewing tool"),
    key("V on ╰ review", "paste the reviewer's report into the reviewed session's input, unsent; read it there, then enter"),
    key("enter on ╰ review", "see what it says, answer its questions"),
    key("x on ╰ review", "close it", "refused while its report is unread: V or m first"),
    key("P", "push the branch and open its pull request, existing or new", "refused: dirty tree, base branch, detached HEAD, reviewer mid-turn"),
    note("One round: V, ask for a spec, enter in the agent, V again, pick the tool, wait, V on ╰ review, enter in the agent. Then v to commit, P to ship."),
    "",
    heading("Rows"),
    key("✳  ⬡", "Claude Code, Codex"),
    key("⎇", "the session lives in a git worktree"),
    key("╰ review", "a reviewer of the row above; its digit stages it like any other"),
    key("input", "blocked on a permission or dialog"),
    key("done", "turn finished after your last prompt, output not looked at yet"),
    key("busy / idle", "working / waiting for you"),
    key("inactive", "not running; a to show, R to resume"),
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
