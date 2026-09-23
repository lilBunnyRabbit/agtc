import pkg from "../../package.json";
import { padRight, plural, tildify, truncate, wrapWords } from "../lib/text";
import { relativeAge } from "../lib/time";
import { HOME } from "../paths";
import { filterSessions, matchSnippet } from "../search";
import { type Session, type Status, STATUSES, type Tool } from "../session";
import { ANSI, clip, style, visibleLength } from "./ansi";
import {
  AGE_WIDTH,
  BLANK_CELLS,
  DETAIL_INDENT,
  type Layout,
  MIN_TITLE_WIDTH,
  PROMPT_AGE_WIDTH,
  type Size,
  STATUS_WIDTH,
  computeLayout,
  rowPrefix,
  rowSuffix,
} from "./layout";
import { ICON, STATUS_LABEL, needsAttention, statusStyle, toolIcon, worktreeIcon } from "./theme";

export interface Prompt {
  label: string;
  value: string;
  /** Values `tab` walks through, when the answer is usually one of a known few. */
  choices?: string[];
}

export interface UiState {
  /** Label for the enter key in the footer. */
  enterHint: string;
  /** Index into the visible (filtered) list. */
  selected: number;
  showInactive: boolean;
  showDetail: boolean;
  /** The full key legend in the footer instead of the keys for the selected row. */
  showKeys: boolean;
  query: string;
  /** Keys go to the search box instead of the list. */
  searchMode: boolean;
  /** A one-line question in the footer; keys go there while it is open. */
  prompt?: Prompt;
  /** Transient status text shown in the footer. */
  message: string;
  refreshedAt: number;
}

export function initialUiState(showInactive: boolean, enterHint = "focus"): UiState {
  return { enterHint, selected: 0, showInactive, showDetail: true, showKeys: false, query: "", searchMode: false, message: "", refreshedAt: Date.now() };
}

export interface Frame {
  lines: string[];
  /** Sessions in list order, so key handlers can map `selected` to a session. */
  visible: Session[];
}

const HEADER_LINES = 2; // header + blank line
/** How many live rows get a digit: one key each. */
const JUMP_KEYS = 9;
const MIN_LIST_LINES = 3;
const PROMPT_LINES = 2;
const MAX_EXTRA_ROOTS = 2;

export function renderFrame(sessions: Session[], ui: UiState, size: Size): Frame {
  const layout = computeLayout(size);
  const visible = filterSessions(sessions, ui);
  const selected = visible[ui.selected];
  const reviews: Reviews = { reviewerOf: liveReviewers(sessions), subjectOf: new Map(sessions.map((s) => [s.id, s])) };

  const list = renderList(visible, ui, layout);
  const footer = renderFooter(ui, selected, layout);
  const room = size.rows - HEADER_LINES - footer.length;
  const detail = ui.showDetail && selected ? fittingDetail(selected, layout, room - MIN_LIST_LINES, reviews) : [];
  const listHeight = Math.max(MIN_LIST_LINES, room - detail.length);
  const body = scrollWindow(list.lines, list.lineOfSelected, listHeight);
  const filler = Array<string>(Math.max(0, listHeight - body.length)).fill("");

  // A line wider than the pane wraps and scrolls the header off the top, so every line is cut.
  const lines = [renderHeader(sessions, visible, ui, layout), "", ...body, ...filler, ...detail, ...footer];
  return { lines: lines.map((line) => clip(line, layout.columns)), visible };
}

/** The live sessions the digit keys stage, in list order: row 1 is the first live row on screen. */
export function jumpTargets(visible: Session[]): Session[] {
  return visible.filter((s) => s.status !== "inactive").slice(0, JUMP_KEYS);
}

/** Who reviews whom, for the marker on a reviewed row and the lines in the detail pane. */
interface Reviews {
  /** The running reviewer of a session, by the reviewed session's id. */
  reviewerOf: Map<string, Session>;
  /** Every session by id, to name what a reviewer reviews. */
  subjectOf: Map<string, Session>;
}

function liveReviewers(sessions: Session[]): Map<string, Session> {
  const map = new Map<string, Session>();
  for (const s of sessions) if (s.reviewOf && s.status !== "inactive" && !map.has(s.reviewOf)) map.set(s.reviewOf, s);
  return map;
}

// ---------------------------------------------------------------- header

/** Full header when it fits; a narrow pane (agtc as a tmux sidebar) gets short status words and no refresh age. */
function renderHeader(sessions: Session[], visible: Session[], ui: UiState, layout: Layout): string {
  const counts = countByStatus(sessions);
  const liveCount = (tool: Tool) => sessions.filter((s) => s.tool === tool && s.status !== "inactive").length;
  const badge = (status: Status, label: string) =>
    needsAttention(status) && counts[status] > 0
      ? style(` ${label} ${counts[status]} `, ...statusStyle(status), ANSI.reverse)
      : style(`${label} ${counts[status]}`, ...statusStyle(status));

  const title = style("agtc", ANSI.bold) + style(` ${pkg.version}`, ANSI.dim);
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
  const digits = new Map(jumpTargets(visible).map((s, i) => [s.id, String(i + 1)]));

  visible.forEach((session, index) => {
    if (session.repo !== currentRepo) {
      currentRepo = session.repo;
      if (lines.length) lines.push("");
      lines.push(repoRule(session.repo, visible.filter((s) => s.repo === currentRepo), layout));
    }
    const isSelected = index === ui.selected;
    if (isSelected) lineOfSelected = lines.length;
    lines.push(sessionLine(session, isSelected, layout, visible[index - 1], digits.get(session.id)));
    const snippet = matchSnippet(session, ui.query);
    if (snippet) lines.push(snippetLine(snippet, isSelected, layout));
  });

  if (!visible.length) {
    const hint = ui.query ? "no sessions match" : `nothing running${ui.showInactive ? "" : " (press a to show inactive)"}`;
    lines.push(style(`   ${hint}`, ANSI.dim));
  }
  return { lines, lineOfSelected };
}

/** The group line carries how many of its sessions want you, so a folded-away group still shows it. */
function repoRule(repo: string, sessions: Session[], layout: Layout): string {
  const label = ` ${repo} `;
  const waiting = (["needs input", "done"] as const)
    .map((status) => [status, sessions.filter((s) => s.status === status).length] as const)
    .filter(([, n]) => n > 0)
    .map(([status, n]) => style(` ${n} ${STATUS_LABEL[status]} `, ...statusStyle(status), ANSI.reverse));
  const summary = `${waiting.length ? ` ${waiting.join(" ")}` : ""} ${style(plural(sessions.length, "session", "sessions"), ANSI.dim)}`;
  const rule = ICON.rule.repeat(Math.max(0, layout.columns - label.length - visibleLength(summary) - 1));
  return style(label, ANSI.bold, ANSI.cyan) + style(rule, ANSI.dim) + summary;
}

function selectionBar(isSelected: boolean): string {
  return isSelected ? style(ICON.selection, ANSI.cyan) : " ";
}

/**
 * A reviewer's row hangs off the row above it: no worktree icon (its subject's says it), a
 * branch glyph, and just "review" when the subject or a sibling reviewer is right above.
 */
function sessionLine(session: Session, isSelected: boolean, layout: Layout, above: Session | undefined, digit: string | undefined): string {
  const inactive = session.status === "inactive";
  const attention = needsAttention(session.status);
  const nested = !!session.reviewOf;
  const underSubject = nested && !!above && (above.id === session.reviewOf || above.reviewOf === session.reviewOf);
  const branch = nested ? `${style(ICON.child, inactive ? ANSI.dim : ANSI.cyan)} ` : "";
  const prefix = rowPrefix({
    bar: selectionBar(isSelected),
    jump: digit ? style(digit, isSelected ? ANSI.cyan : ANSI.dim) : " ",
    worktree: session.worktree && !nested ? worktreeIcon(inactive) : " ",
    tool: toolIcon(session.tool, inactive),
    status: attention
      ? style(padRight(` ${STATUS_LABEL[session.status]}`, STATUS_WIDTH), ...statusStyle(session.status), ANSI.reverse)
      : style(padRight(STATUS_LABEL[session.status], STATUS_WIDTH), ...statusStyle(session.status)),
  });
  const title = padRight(underSubject ? "review" : session.title, layout.titleWidth - visibleLength(branch));
  const styledTitle = isSelected
    ? style(title, ANSI.bold, ANSI.white)
    : inactive
      ? style(title, ANSI.dim)
      : attention
        ? style(title, ...statusStyle(session.status))
        : title;
  const age = style(padRight(relativeAge(session.since), AGE_WIDTH), ANSI.dim);
  return prefix + branch + styledTitle + rowSuffix(age);
}

/** Shows where an older prompt matched the search, aligned under the title. */
function snippetLine(snippet: string, isSelected: boolean, layout: Layout): string {
  const prefix = rowPrefix({ ...BLANK_CELLS, bar: selectionBar(isSelected) });
  return prefix + style(`${ICON.search} ${truncate(snippet, layout.snippetWidth)}`, ANSI.yellow);
}

/** At most `height` lines, the selected one kept roughly centred once the list outgrows the space. */
function scrollWindow(lines: string[], focusLine: number, height: number): string[] {
  const maxStart = Math.max(0, lines.length - height);
  const start = Math.min(Math.max(0, focusLine - Math.floor(height / 2)), maxStart);
  return lines.slice(start, start + height);
}

// ---------------------------------------------------------------- detail pane

// ---------------------------------------------------------------- detail pane

/** Older prompts listed under the latest one when the terminal is tall enough. */
const HISTORY_PROMPTS = 2;
const MIN_RULE = 4;
const SUB_INDENT = "  ";

/** The detail with prompt history when it fits, without when it does not, nothing when even that would squeeze the list. */
function fittingDetail(session: Session, layout: Layout, maxLines: number, reviews: Reviews): string[] {
  for (const history of [HISTORY_PROMPTS, 0]) {
    const lines = renderDetail(session, layout, history, reviews);
    if (lines.length <= maxLines) return lines;
  }
  return [];
}

function renderDetail(session: Session, layout: Layout, history: number, reviews: Reviews): string[] {
  const lines = ["", detailRule(session, layout), "", DETAIL_INDENT + statusLine(session, layout), ""];
  const push = (text: string) => lines.push(DETAIL_INDENT + text);
  const sub = (text: string) => push(SUB_INDENT + text);
  const subWidth = layout.detailWidth - SUB_INDENT.length;

  if (session.root) {
    push(checkoutLine(session) + changesSummary(session));
    if (session.changes?.paths.length) wrapWords(session.changes.paths.join("  "), subWidth, 2).forEach(sub);
    sub(style(truncate(tildify(session.cwd, HOME), subWidth), ANSI.dim));
    for (const root of session.roots.filter((r) => r !== session.root).slice(0, MAX_EXTRA_ROOTS)) {
      sub(style(truncate(`also in ${tildify(root, HOME)}`, subWidth), ANSI.dim));
    }
  } else {
    push(style(truncate(tildify(session.cwd, HOME), layout.detailWidth), ANSI.dim));
  }
  const review = reviewLine(session, reviews, layout.detailWidth);
  if (review) lines.push("", DETAIL_INDENT + review);
  const prompts = promptLines(session, layout, history);
  if (prompts.length) lines.push("", ...prompts.map((line) => DETAIL_INDENT + line));
  lines.push("");
  return lines;
}

/** Title in the rule like the repo rules above; the right end names the tool and, inside tmux, the window as the status bar shows it. */
function detailRule(session: Session, layout: Layout): string {
  const where = session.tmux ? style(` · ${session.tmux.windowIndex}:${session.tmux.windowName}`, ANSI.dim) : "";
  const summary = ` ${toolIcon(session.tool)} ${session.tool}${where}`;
  const title = truncate(session.title, Math.max(MIN_TITLE_WIDTH, layout.columns - visibleLength(summary) - MIN_RULE - 3));
  const label = ` ${title} `;
  const rule = ICON.rule.repeat(Math.max(0, layout.columns - label.length - visibleLength(summary) - 1));
  return style(label, ANSI.bold, ANSI.white) + style(rule, ANSI.dim) + summary;
}

/** State on the left, identity dim on the right; the right end gives way first on a narrow pane. */
function statusLine(session: Session, layout: Layout): string {
  const blockedOn = session.status === "needs input" && session.waitingFor ? `: ${session.waitingFor}` : "";
  const notSeen = session.status === "done" ? style(", not seen yet", ...statusStyle("done")) : "";
  const left = style(session.status + blockedOn, ...statusStyle(session.status)) + style(` for ${relativeAge(session.since)}`, ANSI.dim) + notSeen;
  const meta = [
    session.startedAt ? `started ${relativeAge(session.startedAt)} ago` : "",
    session.pid ? `pid ${session.pid}` : "",
    session.tty ?? "",
  ].filter(Boolean);
  for (let n = meta.length; n > 0; n--) {
    const right = meta.slice(0, n).join(" · ");
    const gap = layout.detailWidth - visibleLength(left) - right.length;
    if (gap >= 3) return left + " ".repeat(gap) + style(right, ANSI.dim);
  }
  return left;
}

/** What a reviewer reviews, or the state of the reviewer a session has. */
function reviewLine(session: Session, { reviewerOf, subjectOf }: Reviews, width: number): string | undefined {
  if (session.reviewOf) {
    const subject = subjectOf.get(session.reviewOf);
    const state = subject ? style(`  ${subject.status}`, ...statusStyle(subject.status)) : "";
    return style(`${ICON.review} reviews `, ANSI.cyan) + truncate(subject?.title ?? session.reviewOf, Math.max(0, width - 10 - visibleLength(state))) + state;
  }
  const reviewer = reviewerOf.get(session.id);
  if (!reviewer) return undefined;
  const state = style(`${reviewer.status} for ${relativeAge(reviewer.since)}`, ...statusStyle(reviewer.status));
  return style(`${ICON.review} reviewer `, ANSI.cyan) + `${toolIcon(reviewer.tool)} ${reviewer.tool}  ` + state;
}

function checkoutLine(session: Session): string {
  const onBranch = session.branch ? style(`  on ${session.branch}`, ANSI.dim) : "";
  return session.worktree ? style(`${ICON.worktree} ${session.worktree}`, ANSI.cyan) + onBranch : `${ICON.mainCheckout} main checkout${onBranch}`;
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

/** The latest prompt with its age, wrapped; up to `history` older ones dim below it, one line each. */
function promptLines(session: Session, layout: Layout, history: number): string[] {
  const latest = session.lastPrompt ?? session.prompts.at(-1);
  if (!latest) return [];
  const cut = session.lastPrompt ? session.prompts.lastIndexOf(session.lastPrompt) : -1;
  const before = cut >= 0 ? session.prompts.slice(0, cut) : session.prompts.slice(0, -1);
  const older = history ? before.filter((prompt) => !prompt.startsWith("/")).slice(-history).reverse() : [];
  const age = session.lastPromptAt ? `${relativeAge(session.lastPromptAt)} ago` : "";
  const gutter = (text: string) => `${ICON.lastPrompt} ${style(padRight(text, PROMPT_AGE_WIDTH), ANSI.dim)}  `;
  const blank = " ".repeat(2 + PROMPT_AGE_WIDTH + 2);
  return [
    ...wrapWords(latest, layout.promptWidth, PROMPT_LINES).map((line, i) => (i === 0 ? gutter(age) : blank) + line),
    ...older.map((prompt) => style(gutter("") + truncate(prompt, layout.promptWidth), ANSI.dim)),
  ];
}

// ---------------------------------------------------------------- footer

const KEY_GAP = "   ";

/**
 * Key hints, wrapped so every one shows however narrow the pane: the keys that act on the
 * selected row, or every key after `?`. A message takes the first line's place while it
 * lasts, so the footer keeps its height and the list stays put.
 */
function renderFooter(ui: UiState, selected: Session | undefined, layout: Layout): string[] {
  if (ui.prompt) {
    const { label, value, choices } = ui.prompt;
    const room = Math.max(0, layout.columns - 2 - label.length - 2);
    // A long path keeps its end, the part that says which checkout it is.
    const shown = value.length > room ? `…${value.slice(value.length - room + 1)}` : value;
    const question = `${label}: ${shown}`;
    const hint = truncate(choices ? "   enter ok · tab next · esc cancel" : "   enter ok · esc cancel", Math.max(0, layout.columns - 2 - question.length));
    return [` ${style(question, ANSI.yellow)}${style("▏", ANSI.bold)}${style(hint, ANSI.dim)}`];
  }
  if (ui.searchMode) {
    const prompt = `/ ${ui.query}`;
    const hint = truncate("   type to filter · ↑↓ move · enter keep · esc clear", Math.max(0, layout.columns - 2 - prompt.length));
    return [` ${style(prompt, ANSI.yellow)}${style("▏", ANSI.bold)}${style(hint, ANSI.dim)}`];
  }
  const keys = ui.showKeys ? allKeys(ui) : rowKeys(ui, selected);
  const lines = wrapItems(keys, KEY_GAP, layout.columns - 1).map((line) => style(` ${line}`, ANSI.dim));
  if (ui.message) lines[0] = ` ${style(truncate(ui.message, Math.max(0, layout.columns - 1)), ANSI.yellow)}`;
  return lines;
}

/** What the selected row can do right now: focus or resume, mark seen only while it is "done". */
function rowKeys(ui: UiState, session: Session | undefined): string[] {
  const search = `/ search${ui.query ? " (esc clears)" : ""}`;
  if (!session) return [search, "? more"];
  const live = session.status !== "inactive";
  return [
    search,
    live ? `enter ${ui.enterHint}` : "R resume in tmux",
    ...(session.status === "done" ? ["m seen"] : []),
    ...(live ? [] : ["c copy resume"]),
    "o editor",
    "v diff",
    session.reviewOf ? "V report" : "V review agent",
    ...(session.reviewOf && live ? ["x close"] : []),
    ...(session.root ? ["P push + PR"] : []),
    "n new agent",
    "N worktree",
    "? more",
  ];
}

function allKeys(ui: UiState): string[] {
  return [
    "↑↓/jk move",
    "g/G top/bottom",
    "J/K stage next/prev",
    "1-9 stage that row",
    `/ search${ui.query ? " (esc clears)" : ""}`,
    `enter ${ui.enterHint}`,
    "o editor",
    "v diff",
    "V review agent / report",
    "P push, open PR",
    "x close reviewer",
    "n new agent",
    "N new worktree",
    "R resume in tmux",
    "S restore hub",
    "m seen",
    "M all seen",
    "c copy resume",
    "r refresh",
    `a inactive:${onOff(ui.showInactive)}`,
    `d detail:${onOff(ui.showDetail)}`,
    "q quit",
    "? less",
  ];
}

/** Greedy line fill: items joined by `gap`, a new line when the next item would not fit. */
function wrapItems(items: string[], gap: string, width: number): string[] {
  const lines: string[] = [];
  let current = "";
  for (const item of items) {
    const candidate = current ? `${current}${gap}${item}` : item;
    if (current && candidate.length > width) {
      lines.push(current);
      current = item;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

const onOff = (flag: boolean) => (flag ? "on" : "off");
