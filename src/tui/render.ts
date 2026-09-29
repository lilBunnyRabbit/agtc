import pkg from "../../package.json";
import { padRight, plural, tildify, truncate, wrapWords } from "../lib/text";
import { relativeAge } from "../lib/time";
import { HOME } from "../paths";
import { filterSessions, matchSnippet } from "../model/search";
import { type Session, type Status, STATUSES, type Tool, type Verdict, workDir } from "../model/session";
import { ACTIONS, type KeyAction, appliesTo, rowOf, shownKey } from "./actions";
import { ANSI, clip, stripAnsi, style, visibleLength } from "./ansi";
import {
  AGE_WIDTH,
  BLANK_CELLS,
  DETAIL_INDENT,
  type Layout,
  MIN_TITLE_WIDTH,
  type Size,
  STATUS_WIDTH,
  SUFFIX_WIDTH,
  computeLayout,
  rowPrefix,
  rowSuffix,
} from "./layout";
import { type Hit, type RenderedBody, jumpTargets, repoRule, rowHit, selectionBar, statusCell } from "./rows";
import { ICON, STATUS_LABEL, needsAttention, statusStyle, toolIcon, worktreeIcon } from "./theme";

export interface Prompt {
  label: string;
  value: string;
  choices?: string[];
}

export interface UiState {
  enterHint: string;
  selected: number;
  showInactive: boolean;
  showDetail: boolean;
  showKeys: boolean;
  /** Two lines a row: more to click on, and room for where the agent works. */
  roomy: boolean;
  query: string;
  searchMode: boolean;
  prompt?: Prompt;
  message: string;
  refreshedAt: number;
  /** The checkout the agtc VS Code window shows, while that window is open. */
  inEditor?: string;
}

export function initialUiState(showInactive: boolean, enterHint = "focus", roomy = false): UiState {
  return { enterHint, selected: 0, showInactive, showDetail: true, showKeys: false, roomy, query: "", searchMode: false, message: "", refreshedAt: Date.now() };
}

export interface Frame {
  lines: string[];
  visible: Session[];
  hits: Hit[][];
}

const HEADER_LINES = 2; // header + blank line
const MIN_LIST_LINES = 3;
const MAX_EXTRA_ROOTS = 2;
const EDITOR_TAG = " vscode ";

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
  const start = scrollStart(list.lines.length, list.lineOfSelected, listHeight);
  const body = list.lines.slice(start, start + listHeight);
  const filler = Array<string>(Math.max(0, listHeight - body.length)).fill("");
  const hits = [...Array.from({ length: HEADER_LINES }, (): Hit[] => []), ...list.hits.slice(start, start + listHeight)];

  // A line wider than the pane wraps and scrolls the header off the top, so every line is cut.
  const lines = [renderHeader(sessions, visible, ui, layout), "", ...body, ...filler, ...detail, ...footer];
  return { lines: lines.map((line) => clip(line, layout.columns)), visible, hits };
}

interface Reviews {
  reviewerOf: Map<string, Session>;
  subjectOf: Map<string, Session>;
}

function liveReviewers(sessions: Session[]): Map<string, Session> {
  const map = new Map<string, Session>();
  for (const s of sessions) if (s.reviewOf && s.status !== "inactive" && !map.has(s.reviewOf)) map.set(s.reviewOf, s);
  return map;
}

// ---------------------------------------------------------------- header

/** Full header when it fits; a narrow pane (agtc as a tmux sidebar) gets short status words and no refresh age. */
export function renderHeader(sessions: Session[], visible: Session[], ui: Pick<UiState, "query" | "refreshedAt">, layout: Layout): string {
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

function renderList(visible: Session[], ui: UiState, layout: Layout): RenderedBody {
  const lines: string[] = [];
  const hits: Hit[][] = [];
  const push = (line: string, session?: Session) => {
    lines.push(line);
    hits.push(rowHit(session, layout.columns));
  };
  let lineOfSelected = 0;
  let currentRepo: string | undefined;
  const digits = new Map(jumpTargets(visible).map((s, i) => [s.id, String(i + 1)]));

  visible.forEach((session, index) => {
    if (session.repo !== currentRepo) {
      currentRepo = session.repo;
      if (lines.length) push("");
      push(repoRule(session.repo, visible.filter((s) => s.repo === currentRepo), layout));
    } else if (ui.roomy) {
      push("", session);
    }
    const isSelected = index === ui.selected;
    if (isSelected) lineOfSelected = lines.length;
    const row = sessionLine(session, isSelected, layout, visible[index - 1], digits.get(session.id), workDir(session) === ui.inEditor, ui.roomy);
    const snippet = matchSnippet(session, ui.query);
    const found = snippet ? [snippetLine(snippet, isSelected, layout, ui.roomy ? blockBar(session, isSelected, "bottom") : undefined)] : [];
    const block = ui.roomy ? [row, aboutLine(session, isSelected, layout, snippet ? "middle" : "bottom"), ...found].map((line) => (isQuiet(session.status) ? line : solid(line, layout, session.status, isSelected))) : [row, ...found];
    for (const line of block) push(line, session);
  });

  if (!visible.length) {
    const hint = ui.query ? "no sessions match" : `nothing running${ui.showInactive ? "" : " (press a to show inactive)"}`;
    push(style(`   ${hint}`, ANSI.dim));
  }
  return { lines, hits, lineOfSelected };
}

/**
 * A reviewer's row hangs off the row above it: no worktree icon (its subject's says it), a
 * branch glyph, and just "review" when the subject or a sibling reviewer is right above.
 */
function sessionLine(session: Session, isSelected: boolean, layout: Layout, above: Session | undefined, digit: string | undefined, inEditor = false, roomy = false): string {
  const inactive = session.status === "inactive";
  const attention = needsAttention(session.status);
  const nested = !!session.reviewOf;
  const underSubject = nested && !!above && (above.id === session.reviewOf || above.reviewOf === session.reviewOf);
  const branch = nested ? `${style(ICON.child, inactive ? ANSI.dim : ANSI.cyan)} ` : "";
  const prefix = rowPrefix({
    bar: roomy ? blockBar(session, isSelected, "top") : selectionBar(isSelected),
    jump: digit ? style(digit, isSelected ? ANSI.cyan : ANSI.dim) : " ",
    worktree: session.worktree && !nested ? worktreeIcon(inactive) : " ",
    tool: toolIcon(session.tool, inactive),
    status: statusCell(session.status),
  });
  const verdict = session.verdict ? verdictTag(session.verdict, inactive) : "";
  const editor = inEditor ? ` ${style(EDITOR_TAG, ANSI.cyan, ANSI.bold, ANSI.reverse)}` : "";
  const space = layout.titleWidth - visibleLength(branch) - visibleLength(verdict) - visibleLength(editor);
  const name = underSubject ? "review" : session.title;
  const about = roomy ? "" : aboutRow(session, space - name.length);
  const room = space - visibleLength(about);
  const title = truncate(name, room);
  const styledTitle = isSelected
    ? style(title, ANSI.bold, ANSI.white)
    : inactive
      ? style(title, ANSI.dim)
      : attention
        ? style(title, ...statusStyle(session.status))
        : title;
  const fill = " ".repeat(Math.max(0, room - title.length));
  const age = style(padRight(relativeAge(session.since), AGE_WIDTH), ANSI.dim);
  return prefix + branch + styledTitle + verdict + fill + editor + about + rowSuffix(age);
}

const FACT_GAP = "  ";
const MAX_WHERE_WIDTH = 28;
const MIN_WHERE_WIDTH = 8;

interface About {
  where: string;
  counts: string[];
}

/** What the agent waits for, else its checkout; then what changed there. */
function aboutOf(session: Session): About {
  const { changes, subagents = [] } = session;
  const busy = subagents.filter((agent) => agent.status === "busy").length;
  const waits = session.status === "needs input" && session.waitingFor;
  return {
    where: waits ? session.waitingFor! : (session.worktree ?? session.branch ?? ""),
    counts: [
      busy ? style(`${ICON.subagent} ${busy}`, ANSI.cyan) : "",
      changes?.paths.length ? `${style(`+${changes.insertions}`, ANSI.green)} ${style(`−${changes.deletions}`, ANSI.magenta)}` : "",
      changes?.ahead ? style(`${changes.ahead} ahead`, ANSI.dim) : "",
    ].filter(Boolean),
  };
}

const whereStyle = ({ status, waitingFor }: Session) => (status === "needs input" && waitingFor ? statusStyle(status) : [ANSI.dim]);

const widthOf = (counts: string[]) => counts.reduce((sum, count) => sum + FACT_GAP.length + visibleLength(count), 0);

/** Takes what the whole title leaves: the counts first, the checkout cut to the rest. */
function aboutRow(session: Session, room: number): string {
  const { where, counts } = aboutOf(session);
  while (counts.length && widthOf(counts) > room) counts.shift();
  const left = Math.min(MAX_WHERE_WIDTH, room - widthOf(counts) - FACT_GAP.length);
  const shown = where && left >= Math.min(MIN_WHERE_WIDTH, where.length) ? [style(truncate(where, left), ...whereStyle(session))] : [];
  return [...shown, ...counts].map((fact) => FACT_GAP + fact).join("");
}

/** Second line of a block: the checkout under the title, the counts at the right end. */
function aboutLine(session: Session, isSelected: boolean, layout: Layout, part: EdgePart): string {
  const indent = session.reviewOf ? "  " : "";
  const width = layout.titleWidth + SUFFIX_WIDTH - indent.length - 1;
  const { where, counts } = aboutOf(session);
  while (counts.length && widthOf(counts) > width) counts.shift();
  const right = counts.join(FACT_GAP);
  const left = style(truncate(where || tildify(workDir(session), HOME), Math.max(0, width - widthOf(counts))), ...whereStyle(session));
  const fill = " ".repeat(Math.max(0, width - visibleLength(left) - visibleLength(right)));
  return rowPrefix({ ...BLANK_CELLS, bar: blockBar(session, isSelected, part) }) + indent + left + fill + right;
}

type EdgePart = keyof typeof ICON.edge;

/** A terminal has no half lines of space. An edge that starts and ends mid-line leaves a gap between two rows all the same. */
const blockBar = (session: Session, isSelected: boolean, part: EdgePart) =>
  isSelected ? style(ICON.selectionEdge[part], ANSI.cyan) : style(ICON.edge[part], ...statusStyle(session.status));

const isQuiet = (status: Status) => status === "idle" || status === "inactive";

/**
 * A row that works or waits for you, in the full colour of its status. Reverse video puts the terminal's background in the text, so no colour inside the line survives, and a bar in it would show as a notch: the selection's stays outside.
 */
function solid(line: string, layout: Layout, status: Status, isSelected: boolean): string {
  const body = ` ${stripAnsi(line).slice(2)}`;
  const fill = " ".repeat(Math.max(0, layout.columns - 2 - body.length));
  const block = style((isSelected ? body.slice(1) : body) + fill, statusStyle(status)[0], ANSI.reverse, ...(isSelected ? [ANSI.bold] : []));
  return ` ${isSelected ? selectionBar(true) : ""}${block}`;
}

function snippetLine(snippet: string, isSelected: boolean, layout: Layout, bar = selectionBar(isSelected)): string {
  const prefix = rowPrefix({ ...BLANK_CELLS, bar });
  return prefix + style(`${ICON.search} ${truncate(snippet, layout.snippetWidth)}`, ANSI.yellow);
}

/** First list line on screen: the focused line sits mid-window, except at the ends. */
function scrollStart(length: number, focusLine: number, height: number): number {
  const maxStart = Math.max(0, length - height);
  return Math.min(Math.max(0, focusLine - Math.floor(height / 2)), maxStart);
}

// ---------------------------------------------------------------- detail pane

const MIN_RULE = 4;
const SUB_INDENT = "  ";

function fittingDetail(session: Session, layout: Layout, maxLines: number, reviews: Reviews): string[] {
  const lines = renderDetail(session, layout, reviews);
  return lines.length <= maxLines ? lines : [];
}

function renderDetail(session: Session, layout: Layout, reviews: Reviews): string[] {
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
  if (review) lines.push("", ...review.split("\n").map((line, i) => (i ? line : DETAIL_INDENT + line)));
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

/** " · ready" in green, " · not ready" in magenta, after the title. */
function verdictTag({ ready }: Verdict, dimmed: boolean): string {
  return style(` · ${ready ? "ready" : "not ready"}`, dimmed ? ANSI.dim : ready ? ANSI.green : ANSI.magenta);
}

function reviewLine(session: Session, { reviewerOf, subjectOf }: Reviews, width: number): string | undefined {
  if (session.reviewOf) {
    const subject = subjectOf.get(session.reviewOf);
    const state = subject ? style(`  ${subject.status}`, ...statusStyle(subject.status)) : "";
    const head = style(`${ICON.review} reviews `, ANSI.cyan) + truncate(subject?.title ?? session.reviewOf, Math.max(0, width - 10 - visibleLength(state))) + state;
    return session.verdict ? `${head}\n${DETAIL_INDENT}${SUB_INDENT}${verdictText(session.verdict, width - SUB_INDENT.length)}` : head;
  }
  const reviewer = reviewerOf.get(session.id);
  if (!reviewer) return undefined;
  const state = style(`${reviewer.status} for ${relativeAge(reviewer.since)}`, ...statusStyle(reviewer.status));
  const head = style(`${ICON.review} reviewer `, ANSI.cyan) + `${toolIcon(reviewer.tool)} ${reviewer.tool}  ` + state;
  return reviewer.verdict ? `${head}\n${DETAIL_INDENT}${SUB_INDENT}${verdictText(reviewer.verdict, width - SUB_INDENT.length)}` : head;
}

function verdictText({ ready, text }: Verdict, width: number): string {
  return style(`${ready ? "ready" : "not ready"}  `, ready ? ANSI.green : ANSI.magenta) + style(truncate(text, Math.max(0, width - 12)), ANSI.dim);
}

function checkoutLine(session: Session): string {
  const onBranch = session.branch ? style(`  on ${session.branch}`, ANSI.dim) : "";
  return session.worktree ? style(`${ICON.worktree} ${session.worktree}`, ANSI.cyan) + onBranch : `${ICON.mainCheckout} main checkout${onBranch}`;
}

function changesSummary({ changes }: Session): string {
  if (!changes) return "";
  const work = changes.paths.length
    ? `${plural(changes.paths.length, "file", "files")} ${style(`+${changes.insertions}`, ANSI.green)} ${style(`−${changes.deletions}`, ANSI.magenta)}`
    : style("clean", ANSI.dim);
  const ahead = changes.ahead ? style(`   ${changes.ahead} ahead of ${changes.base}`, ANSI.dim) : "";
  return `   ${work}${ahead}`;
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

const hintOf = (ui: UiState) => (action: KeyAction) => `${shownKey(action)} ${action.state?.(ui) ?? action.label}`;

/** What the selected row can do right now: focus or resume, mark seen only while it is "done". */
function rowKeys(ui: UiState, session: Session | undefined): string[] {
  const hints = ACTIONS.filter((action) => action.hint);
  return (session ? hints.filter(appliesTo(rowOf(session))) : hints.filter((action) => action.section === "list" || action.section === "look")).map(hintOf(ui));
}

const allKeys = (ui: UiState) => ACTIONS.map(hintOf(ui));

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
