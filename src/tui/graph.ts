import { padRight, truncate } from "../lib/text";
import { relativeAge } from "../lib/time";
import type { Session, Subagent } from "../session";
import { ANSI, style } from "./ansi";
import { AGE_WIDTH, BLANK_CELLS, type Layout, MIN_TITLE_WIDTH, PREFIX_WIDTH, RIGHT_MARGIN_WIDTH, STATUS_WIDTH, SUFFIX_WIDTH, rowPrefix, rowSuffix } from "./layout";
import { type RenderedBody, jumpTargets, repoRule, selectionBar, statusCell } from "./rows";
import { ICON, needsAttention, statusStyle, toolIcon, worktreeIcon } from "./theme";

/*
 * The graph: a session on the left, what it spawned on the right, like a pipeline.
 *
 *    ▌ 2 ⎇  ✳  idle      Transitions.dev animations  ─┬ 3 ⬡  busy      review                     4m
 *                                                      └   ◇  busy      Explore: callers of X      1m
 *      4    ✳  busy      exam-prep-testing-flow      ── 5 ✳  done      review                     9m
 *
 * Children are the running reviewers of a session and its subagents. A pane too narrow for
 * two columns stacks the children under their parent instead.
 */

/** Either side of a node's box drawing. Same width each, so the child column lines up. */
const EDGE = { one: " ── ", first: " ─┬ ", middle: "  ├ ", last: "  └ " } as const;
const EDGE_WIDTH = EDGE.one.length;
/** digit, icon, status, with a space after each. */
const CHILD_PREFIX_WIDTH = 1 + 1 + 1 + 1 + STATUS_WIDTH + 1;
/** Share of the title room the parent takes; children carry a type and a description, so they get more. */
const PARENT_SHARE = 0.45;

interface Child {
  /** A reviewer: a session in its own right, selectable, with keys of its own. */
  session?: Session;
  subagent?: Subagent;
}

interface Columns {
  parentWidth: number;
  /** Width for a child's title; 0 means children stack under the parent. */
  childWidth: number;
}

export function renderGraph(visible: Session[], all: Session[], selected: number, layout: Layout): RenderedBody {
  const lines: string[] = [];
  const sessions: (Session | undefined)[] = [];
  let lineOfSelected = 0;
  const push = (line: string, session?: Session) => {
    lines.push(line);
    sessions.push(session);
  };
  const digits = new Map(jumpTargets(visible).map((s, i) => [s.id, String(i + 1)]));
  const ids = new Set(visible.map((s) => s.id));
  const parents = visible.filter((s) => !s.reviewOf || !ids.has(s.reviewOf));
  const columns = graphColumns(layout);
  const isSelected = (session: Session) => visible.indexOf(session) === selected;
  let currentRepo: string | undefined;

  for (const parent of parents) {
    if (parent.repo !== currentRepo) {
      currentRepo = parent.repo;
      if (lines.length) push("");
      push(repoRule(parent.repo, visible.filter((s) => s.repo === currentRepo), layout));
    }
    const children: Child[] = [
      ...visible.filter((s) => s.reviewOf === parent.id).map((session) => ({ session })),
      ...(parent.subagents ?? []).map((subagent) => ({ subagent })),
    ];
    const parentCell = parentNode(parent, isSelected(parent), digits.get(parent.id), columns.parentWidth);
    if (isSelected(parent)) lineOfSelected = lines.length;

    if (!columns.childWidth) {
      push(parentCell, parent);
      for (const child of children) {
        if (child.session && isSelected(child.session)) lineOfSelected = lines.length;
        push(rowPrefix({ ...BLANK_CELLS, bar: selectionBar(!!child.session && isSelected(child.session)) }) + style(`${ICON.child} `, ANSI.cyan) + childNode(child, digits, columns.parentWidth - 2), child.session ?? parent);
      }
      continue;
    }

    if (!children.length) {
      push(parentCell, parent);
      continue;
    }
    const indent = " ".repeat(PREFIX_WIDTH + columns.parentWidth);
    children.forEach((child, i) => {
      const edge = i === 0 ? (children.length === 1 ? EDGE.one : EDGE.first) : i === children.length - 1 ? EDGE.last : EDGE.middle;
      const own = child.session ? isSelected(child.session) : false;
      if (own) lineOfSelected = lines.length;
      const left = i === 0 ? parentCell : indent;
      push(left + style(edge, ANSI.dim) + childNode(child, digits, columns.childWidth), child.session ?? parent);
    });
  }

  if (!visible.length) push(style("   nothing running", ANSI.dim));
  return { lines, sessions, lineOfSelected };
}

/** Title room split between the two columns; stacked when a child could not show a title. */
function graphColumns(layout: Layout): Columns {
  const room = layout.columns - PREFIX_WIDTH - EDGE_WIDTH - CHILD_PREFIX_WIDTH - SUFFIX_WIDTH - RIGHT_MARGIN_WIDTH;
  const parentWidth = Math.max(MIN_TITLE_WIDTH, Math.floor(room * PARENT_SHARE));
  const childWidth = room - parentWidth;
  return childWidth >= MIN_TITLE_WIDTH ? { parentWidth, childWidth } : { parentWidth: layout.titleWidth, childWidth: 0 };
}

/** The list's row cells, the title cut to the parent column. */
function parentNode(session: Session, selected: boolean, digit: string | undefined, width: number): string {
  const attention = needsAttention(session.status);
  const prefix = rowPrefix({
    bar: selectionBar(selected),
    jump: digit ? style(digit, selected ? ANSI.cyan : ANSI.dim) : " ",
    worktree: session.worktree ? worktreeIcon() : " ",
    tool: toolIcon(session.tool),
    status: statusCell(session.status),
  });
  const title = padRight(truncate(session.title, width), width);
  return prefix + (selected ? style(title, ANSI.bold, ANSI.white) : attention ? style(title, ...statusStyle(session.status)) : title);
}

/** A reviewer with its digit, or a subagent: type, then what it was asked. */
function childNode({ session, subagent }: Child, digits: Map<string, string>, width: number): string {
  if (session) {
    const digit = digits.get(session.id);
    const cell = `${digit ? style(digit, ANSI.dim) : " "} ${toolIcon(session.tool)} ${statusCell(session.status)} `;
    const title = padRight("review", width);
    return cell + (needsAttention(session.status) ? style(title, ...statusStyle(session.status)) : title) + age(session.since);
  }
  const { kind, description, status, since } = subagent!;
  const busy = status === "busy";
  const cell = `  ${style(ICON.subagent, busy ? ANSI.cyan : ANSI.dim)} ${style(padRight(status, STATUS_WIDTH), busy ? ANSI.yellow : ANSI.dim)} `;
  const title = truncate(kind ? `${kind}: ${description}` : description, width);
  return cell + (busy ? padRight(title, width) : style(padRight(title, width), ANSI.dim)) + age(since);
}

const age = (since: number) => rowSuffix(style(padRight(relativeAge(since), AGE_WIDTH), ANSI.dim));
