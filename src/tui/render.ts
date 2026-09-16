import { padRight, tildify, truncate, wrapWords } from "../lib/text";
import { relativeAge } from "../lib/time";
import { HOME } from "../paths";
import { filterSessions, matchSnippet } from "../search";
import { type Session, type Status, STATUSES, type Tool } from "../session";
import { ANSI, clip, style, visibleLength } from "./ansi";
import { AGE_WIDTH, BLANK_CELLS, DETAIL_INDENT, type Layout, type Size, STATUS_WIDTH, computeLayout, rowPrefix, rowSuffix } from "./layout";
import { ICON, STATUS_LABEL, statusStyle, toolIcon, worktreeIcon } from "./theme";

export interface UiState {
  /** Label for the enter key in the footer. */
  enterHint: string;
  /** Index into the visible (filtered) list. */
  selected: number;
  showInactive: boolean;
  showDetail: boolean;
  query: string;
  /** Keys go to the search box instead of the list. */
  searchMode: boolean;
  /** A one-line question in the footer; keys go there while it is open. */
  prompt?: { label: string; value: string };
  /** Transient status text shown in the footer. */
  message: string;
  refreshedAt: number;
}

export function initialUiState(showInactive: boolean, enterHint = "focus"): UiState {
  return { enterHint, selected: 0, showInactive, showDetail: true, query: "", searchMode: false, message: "", refreshedAt: Date.now() };
}

export interface Frame {
  lines: string[];
  /** Sessions in list order, so key handlers can map `selected` to a session. */
  visible: Session[];
}

const HEADER_LINES = 2; // header + blank line
const FOOTER_LINES = 1;
const MIN_LIST_LINES = 3;
const PROMPT_LINES = 2;
const MAX_EXTRA_ROOTS = 2;

export function renderFrame(sessions: Session[], ui: UiState, size: Size): Frame {
  const layout = computeLayout(size);
  const visible = filterSessions(sessions, ui);
  const selected = visible[ui.selected];

  const list = renderList(visible, ui, layout);
  const chrome = HEADER_LINES + FOOTER_LINES;
  const wanted = ui.showDetail && selected ? renderDetail(selected, layout) : [];
  const detail = size.rows - chrome - wanted.length >= MIN_LIST_LINES ? wanted : [];
  const body = scrollWindow(list.lines, list.lineOfSelected, Math.max(MIN_LIST_LINES, size.rows - chrome - detail.length));

  // A line wider than the pane wraps and scrolls the header off the top, so every line is cut.
  const lines = [renderHeader(sessions, visible, ui, layout), "", ...body, ...detail, renderFooter(ui, layout)];
  return { lines: lines.map((line) => clip(line, layout.columns)), visible };
}

// ---------------------------------------------------------------- header

/** Full header when it fits; a narrow pane (agtc as a tmux sidebar) gets short status words and no refresh age. */
function renderHeader(sessions: Session[], visible: Session[], ui: UiState, layout: Layout): string {
  const counts = countByStatus(sessions);
  const liveCount = (tool: Tool) => sessions.filter((s) => s.tool === tool && s.status !== "inactive").length;
  const badge = (status: Status, label: string) => style(`${label} ${counts[status]}`, ...statusStyle(status));

  const title = style("agtc", ANSI.bold);
  const tools = `${toolIcon("claude")} ${liveCount("claude")}  ${toolIcon("codex")} ${liveCount("codex")}`;
  const refreshed = style(`   refreshed ${relativeAge(ui.refreshedAt)} ago`, ANSI.dim);
  const matches = ui.query ? `   ${style(`${ICON.search} "${ui.query}" ${plural(visible.length, "match", "matches")}`, ANSI.yellow)}` : "";

  const wide = ` ${title}   ${tools}     ${STATUSES.map((s) => badge(s, s)).join("   ")}${refreshed}${matches}`;
  if (visibleLength(wide) <= layout.columns) return wide;
  const badges = STATUSES.map((s) => badge(s, STATUS_LABEL[s])).join("  ");
  const compact = ` ${title}  ${tools}   ${badges}${matches}`;
  return visibleLength(compact) <= layout.columns ? compact : ` ${title}  ${badges}${matches}`;
}

function countByStatus(sessions: Session[]): Record<Status, number> {
  const counts = Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<Status, number>;
  for (const { status } of sessions) counts[status]++;
  return counts;
}

// ---------------------------------------------------------------- list

interface RenderedList {
  lines: string[];
  /** Line index of the selected session, for scrolling. */
  lineOfSelected: number;
}

/** One line per session, grouped under a rule per repo. */
function renderList(visible: Session[], ui: UiState, layout: Layout): RenderedList {
  const lines: string[] = [];
  let lineOfSelected = 0;
  let currentRepo: string | undefined;

  visible.forEach((session, index) => {
    if (session.repo !== currentRepo) {
      currentRepo = session.repo;
      if (lines.length) lines.push("");
      lines.push(repoRule(session.repo, visible.filter((s) => s.repo === currentRepo).length, layout));
    }
    const isSelected = index === ui.selected;
    if (isSelected) lineOfSelected = lines.length;
    lines.push(sessionLine(session, isSelected, layout));
    const snippet = matchSnippet(session, ui.query);
    if (snippet) lines.push(snippetLine(snippet, isSelected, layout));
  });

  if (!visible.length) {
    const hint = ui.query ? "no sessions match" : `nothing running${ui.showInactive ? "" : " (press a to show inactive)"}`;
    lines.push(style(`   ${hint}`, ANSI.dim));
  }
  return { lines, lineOfSelected };
}

function repoRule(repo: string, count: number, layout: Layout): string {
  const label = ` ${repo} `;
  const summary = ` ${plural(count, "session", "sessions")}`;
  const rule = ICON.rule.repeat(Math.max(0, layout.columns - label.length - summary.length - 1));
  return style(label, ANSI.bold, ANSI.cyan) + style(rule + summary, ANSI.dim);
}

function selectionBar(isSelected: boolean): string {
  return isSelected ? style(ICON.selection, ANSI.cyan) : " ";
}

function sessionLine(session: Session, isSelected: boolean, layout: Layout): string {
  const inactive = session.status === "inactive";
  const prefix = rowPrefix({
    bar: selectionBar(isSelected),
    worktree: session.worktree ? worktreeIcon(inactive) : " ",
    tool: toolIcon(session.tool, inactive),
    status: style(padRight(STATUS_LABEL[session.status], STATUS_WIDTH), ...statusStyle(session.status)),
  });
  const title = padRight(session.title, layout.titleWidth);
  const styledTitle = isSelected
    ? style(title, ANSI.bold, ANSI.white)
    : inactive
      ? style(title, ANSI.dim)
      : session.status === "done"
        ? style(title, ANSI.bold)
        : title;
  const age = style(padRight(relativeAge(session.since), AGE_WIDTH), ANSI.dim);
  return prefix + styledTitle + rowSuffix(age);
}

/** Shows where an older prompt matched the search, aligned under the title. */
function snippetLine(snippet: string, isSelected: boolean, layout: Layout): string {
  const prefix = rowPrefix({ ...BLANK_CELLS, bar: selectionBar(isSelected) });
  return prefix + style(`${ICON.search} ${truncate(snippet, layout.snippetWidth)}`, ANSI.yellow);
}

/** Keeps the selected line roughly centred once the list outgrows the space. */
function scrollWindow(lines: string[], focusLine: number, height: number): string[] {
  const maxStart = Math.max(0, lines.length - height);
  const start = Math.min(Math.max(0, focusLine - Math.floor(height / 2)), maxStart);
  const window = lines.slice(start, start + height);
  while (window.length < height) window.push("");
  return window;
}

// ---------------------------------------------------------------- detail pane

function renderDetail(session: Session, layout: Layout): string[] {
  const lines: string[] = [style(ICON.rule.repeat(layout.columns), ANSI.dim), ""];
  const push = (text: string) => lines.push(DETAIL_INDENT + text);

  push(style(truncate(session.title, layout.detailWidth), ANSI.bold, ANSI.white));
  push(statusLine(session));
  lines.push("");
  push(style(truncate(tildify(session.cwd, HOME), layout.detailWidth), ANSI.dim));
  push(checkoutLine(session) + changesSummary(session));
  if (session.changes?.paths.length) push(style(truncate(session.changes.paths.join("  "), layout.detailWidth), ANSI.dim));
  for (const root of session.roots.filter((r) => r !== session.root).slice(0, MAX_EXTRA_ROOTS)) {
    push(style(truncate(`${ICON.worktree} also in ${tildify(root, HOME)}`, layout.detailWidth), ANSI.dim));
  }
  if (session.lastPrompt) {
    lines.push("");
    wrapWords(session.lastPrompt, layout.promptWidth, PROMPT_LINES).forEach((line, i) => push(`${i === 0 ? `${ICON.lastPrompt} ` : "  "}${line}`));
  }
  lines.push("");
  return lines;
}

function statusLine(session: Session): string {
  const blockedOn = session.status === "needs input" && session.waitingFor ? `: ${session.waitingFor}` : "";
  const word = session.status === "done" ? "done, not seen yet" : session.status;
  const meta = [session.pid && `pid ${session.pid}`, session.tty].filter(Boolean).map((m) => `   ${m}`).join("");
  return (
    style(word + blockedOn, ...statusStyle(session.status)) +
    style(` for ${relativeAge(session.since)}`, ANSI.dim) +
    `   ${toolIcon(session.tool)} ${session.tool}` +
    style(meta, ANSI.dim)
  );
}

function checkoutLine(session: Session): string {
  const onBranch = session.branch ? `  on ${session.branch}` : "";
  return session.worktree
    ? style(`${ICON.worktree} ${session.worktree}`, ANSI.cyan) + style(onBranch, ANSI.dim)
    : style(`${ICON.mainCheckout} main checkout${onBranch}`, ANSI.dim);
}

/** "   3 files +120 −14   2 ahead of origin/main", or "clean" when nothing is pending. */
function changesSummary({ changes }: Session): string {
  if (!changes) return "";
  const work = changes.paths.length
    ? `${plural(changes.paths.length, "file", "files")} ${style(`+${changes.insertions}`, ANSI.green)} ${style(`−${changes.deletions}`, ANSI.magenta)}`
    : style("clean", ANSI.dim);
  const ahead = changes.ahead ? style(`   ${changes.ahead} ahead of ${changes.base}`, ANSI.dim) : "";
  return `   ${work}${ahead}`;
}

// ---------------------------------------------------------------- footer

/** Key hints, cut from the right to fit; a message keeps its room first. */
function renderFooter(ui: UiState, layout: Layout): string {
  if (ui.prompt) {
    const question = `${ui.prompt.label}: ${ui.prompt.value}`;
    const hint = truncate("   enter ok · esc cancel", Math.max(0, layout.columns - 2 - question.length));
    return ` ${style(question, ANSI.yellow)}${style("▏", ANSI.bold)}${style(hint, ANSI.dim)}`;
  }
  if (ui.searchMode) {
    const prompt = `/ ${ui.query}`;
    const hint = truncate("   type to filter · ↑↓ move · enter keep · esc clear", Math.max(0, layout.columns - 2 - prompt.length));
    return ` ${style(prompt, ANSI.yellow)}${style("▏", ANSI.bold)}${style(hint, ANSI.dim)}`;
  }
  const keys = [
    "↑↓/jk move",
    `/ search${ui.query ? " (esc clears)" : ""}`,
    `enter ${ui.enterHint}`,
    "o editor",
    "v diff",
    "n new agent",
    "N new worktree",
    "R resume in tmux",
    "m seen",
    "M all",
    "c resume",
    `a inactive:${onOff(ui.showInactive)}`,
    `d detail:${onOff(ui.showDetail)}`,
    "q quit",
  ];
  const message = truncate(ui.message, Math.max(0, layout.columns - 4));
  const room = Math.max(0, layout.columns - 1 - (message ? message.length + 3 : 0));
  return style(` ${truncate(keys.join("   "), room)}`, ANSI.dim) + (message ? `   ${style(message, ANSI.yellow)}` : "");
}

const onOff = (flag: boolean) => (flag ? "on" : "off");
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
