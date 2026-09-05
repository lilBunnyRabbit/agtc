import { padRight, tildify, truncate, wrapWords } from "../lib/text";
import { relativeAge } from "../lib/time";
import { HOME } from "../paths";
import { filterSessions, matchSnippet } from "../search";
import { type Session, type Status, STATUSES, type Tool } from "../session";
import { ANSI, style } from "./ansi";
import { AGE_WIDTH, BLANK_CELLS, DETAIL_INDENT, type Layout, type Size, STATUS_WIDTH, computeLayout, rowPrefix, rowSuffix } from "./layout";
import { ICON, STATUS_LABEL, statusStyle, toolIcon, worktreeIcon } from "./theme";

export interface UiState {
  /** Index into the visible (filtered) list. */
  selected: number;
  showInactive: boolean;
  showDetail: boolean;
  query: string;
  /** Keys go to the search box instead of the list. */
  searchMode: boolean;
  /** Transient status text shown in the footer. */
  message: string;
  refreshedAt: number;
}

export function initialUiState(showInactive: boolean): UiState {
  return { selected: 0, showInactive, showDetail: true, query: "", searchMode: false, message: "", refreshedAt: Date.now() };
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

export function renderFrame(sessions: Session[], ui: UiState, size: Size): Frame {
  const layout = computeLayout(size);
  const visible = filterSessions(sessions, ui);
  const selected = visible[ui.selected];

  const list = renderList(visible, ui, layout);
  const detail = ui.showDetail && selected ? renderDetail(selected, layout) : [];
  const listHeight = Math.max(MIN_LIST_LINES, size.rows - HEADER_LINES - detail.length - FOOTER_LINES);
  const body = scrollWindow(list.lines, list.lineOfSelected, listHeight);

  return { lines: [renderHeader(sessions, visible, ui), "", ...body, ...detail, renderFooter(ui)], visible };
}

// ---------------------------------------------------------------- header

function renderHeader(sessions: Session[], visible: Session[], ui: UiState): string {
  const counts = countByStatus(sessions);
  const liveCount = (tool: Tool) => sessions.filter((s) => s.tool === tool && s.status !== "inactive").length;
  const badge = (status: Status) => style(`${status} ${counts[status]}`, ...statusStyle(status));

  const title = style("agtc", ANSI.bold);
  const tools = `${toolIcon("claude")} ${liveCount("claude")}  ${toolIcon("codex")} ${liveCount("codex")}`;
  const badges = STATUSES.map(badge).join("   ");
  const refreshed = style(`   refreshed ${relativeAge(ui.refreshedAt)} ago`, ANSI.dim);
  const matches = ui.query ? `   ${style(`${ICON.search} "${ui.query}" ${plural(visible.length, "match", "matches")}`, ANSI.yellow)}` : "";
  return ` ${title}   ${tools}     ${badges}${refreshed}${matches}`;
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
  push(checkoutLine(session));
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

// ---------------------------------------------------------------- footer

function renderFooter(ui: UiState): string {
  if (ui.searchMode) {
    return ` ${style(`/ ${ui.query}`, ANSI.yellow)}${style("▏", ANSI.bold)}${style("   type to filter · ↑↓ move · enter keep · esc clear", ANSI.dim)}`;
  }
  const keys = [
    "↑↓/jk move",
    `/ search${ui.query ? " (esc clears)" : ""}`,
    "enter focus tab",
    "m seen",
    "M all seen",
    "c copy resume",
    `a inactive:${onOff(ui.showInactive)}`,
    `d detail:${onOff(ui.showDetail)}`,
    "q quit",
  ];
  const message = ui.message ? `   ${style(ui.message, ANSI.yellow)}` : "";
  return style(` ${keys.join("   ")}`, ANSI.dim) + message;
}

const onOff = (flag: boolean) => (flag ? "on" : "off");
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
