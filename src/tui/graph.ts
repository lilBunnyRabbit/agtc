import { padRight } from "../lib/text";
import { relativeAge } from "../lib/time";
import type { Session, Subagent } from "../session";
import { ANSI, clip, style, visibleLength } from "./ansi";
import type { Layout } from "./layout";
import { type Hit, type RenderedBody, jumpTargets, repoRule } from "./rows";
import { ICON, STATUS_LABEL, needsAttention, statusStyle, toolIcon, worktreeIcon } from "./theme";

/*
 * The graph: every running session a box, what it spawned in boxes to its right, arrows
 * between them. Like a CI pipeline, read left to right.
 *
 *   ┌──────────────────────────────┐    ┌──────────────────────────────┐
 *   │ 2 ✳ ⎇ Transitions.dev anima… │─┬─▶│ 3 ⬡ review                   │
 *   │   idle · 5m · feat/motion    │ │  │   busy · 4m                  │
 *   └──────────────────────────────┘ │  └──────────────────────────────┘
 *                                    │  ┌──────────────────────────────┐
 *                                    └─▶│ ◇ Explore: callers of Header │
 *                                       │   busy · 1m                  │
 *                                       └──────────────────────────────┘
 *
 * The border takes the status colour; the selected box is drawn heavy. A pane too narrow for
 * two columns hangs the children under their parent.
 */

const MARGIN = " ";
const MIN_BOX_WIDTH = 26;
const MAX_BOX_WIDTH = 60;
/** Rows of one box: two borders, two lines. */
const BOX_HEIGHT = 4;
/** The row of a box an arrow leaves from and arrives at. */
const ARROW_ROW = 1;
const CONNECTOR_WIDTH = 4;
/** Narrow mode: the trunk under the parent and the arrow into each child. */
const HANG_WIDTH = 5;

const LIGHT = { tl: "┌", tr: "┐", bl: "└", br: "┘", h: "─", v: "│", tee: "┬" };
const HEAVY = { tl: "┏", tr: "┓", bl: "┗", br: "┛", h: "━", v: "┃", tee: "┳" };

interface Node {
  /** Two lines of content, unpadded. */
  lines: string[];
  colour: string[];
  /** What a click on it selects: a session, or the parent for a subagent. */
  session: Session;
  selected: boolean;
}

export function renderGraph(visible: Session[], selected: number, layout: Layout): RenderedBody {
  const lines: string[] = [];
  const hits: Hit[][] = [];
  let lineOfSelected = 0;
  const push = (line: string, rowHits: Hit[] = []) => {
    lines.push(line);
    hits.push(rowHits);
  };
  const digits = new Map(jumpTargets(visible).map((s, i) => [s.id, String(i + 1)]));
  const ids = new Set(visible.map((s) => s.id));
  const roots = visible.filter((s) => !s.reviewOf || !ids.has(s.reviewOf));
  const isSelected = (session: Session) => visible.indexOf(session) === selected;
  const twoColumns = layout.columns >= MARGIN.length + MIN_BOX_WIDTH * 2 + CONNECTOR_WIDTH;
  const boxWidth = twoColumns
    ? Math.min(MAX_BOX_WIDTH, Math.floor((layout.columns - MARGIN.length - CONNECTOR_WIDTH) / 2))
    : Math.max(MIN_BOX_WIDTH, Math.min(MAX_BOX_WIDTH, layout.columns - MARGIN.length - HANG_WIDTH));
  let currentRepo: string | undefined;

  for (const root of roots) {
    if (root.repo !== currentRepo) {
      currentRepo = root.repo;
      if (lines.length) push("");
      push(repoRule(root.repo, visible.filter((s) => s.repo === currentRepo), layout));
    } else {
      push("");
    }
    const parent = sessionNode(root, isSelected(root), digits.get(root.id));
    const children = [
      ...visible.filter((s) => s.reviewOf === root.id).map((s) => sessionNode(s, isSelected(s), digits.get(s.id))),
      ...(root.subagents ?? []).map((agent) => subagentNode(agent, root)),
    ];
    const parentBox = drawBox(parent, boxWidth, !twoColumns && children.length ? HANG_WIDTH - 2 : undefined);
    const childBoxes = children.map((child) => drawBox(child, boxWidth));
    if (parent.selected) lineOfSelected = lines.length + ARROW_ROW;
    children.forEach((child, i) => {
      if (child.selected) lineOfSelected = lines.length + (twoColumns ? i * BOX_HEIGHT : BOX_HEIGHT + i * BOX_HEIGHT) + ARROW_ROW;
    });

    if (twoColumns) {
      const height = Math.max(BOX_HEIGHT, children.length * BOX_HEIGHT);
      const childX = MARGIN.length + boxWidth + CONNECTOR_WIDTH;
      for (let row = 0; row < height; row++) {
        const left = parentBox[row] ?? " ".repeat(boxWidth);
        const child = childBoxes[Math.floor(row / BOX_HEIGHT)];
        const right = child?.[row % BOX_HEIGHT] ?? "";
        const rowHits: Hit[] = [];
        if (row < BOX_HEIGHT) rowHits.push({ from: MARGIN.length, to: MARGIN.length + boxWidth, session: parent.session });
        if (child) rowHits.push({ from: childX, to: childX + boxWidth, session: children[Math.floor(row / BOX_HEIGHT)].session });
        push(MARGIN + left + style(connector(row, children.length), ANSI.dim) + right, rowHits);
      }
      continue;
    }

    for (const line of parentBox) push(MARGIN + line, [{ from: MARGIN.length, to: MARGIN.length + boxWidth, session: parent.session }]);
    childBoxes.forEach((box, i) => {
      const last = i === children.length - 1;
      box.forEach((line, row) => {
        const hang = row === ARROW_ROW ? (last ? "   └▶" : "   ├▶") : last && row > ARROW_ROW ? "     " : "   │ ";
        push(MARGIN + style(hang, ANSI.dim) + line, [{ from: MARGIN.length + HANG_WIDTH, to: MARGIN.length + HANG_WIDTH + boxWidth, session: children[i].session }]);
      });
    });
  }

  if (!visible.length) push(style("   nothing running", ANSI.dim));
  return { lines, hits, lineOfSelected };
}

/** A session's box: its digit, tool, worktree and title, then status, age and branch. */
function sessionNode(session: Session, selected: boolean, digit: string | undefined): Node {
  const attention = needsAttention(session.status);
  const head = `${digit ? style(digit, selected ? ANSI.cyan : ANSI.dim) : " "} ${toolIcon(session.tool)} ${session.worktree && !session.reviewOf ? `${worktreeIcon()} ` : ""}`;
  const title = session.reviewOf ? "review" : session.title;
  const status = attention
    ? style(` ${STATUS_LABEL[session.status]} `, ...statusStyle(session.status), ANSI.reverse)
    : style(STATUS_LABEL[session.status], ...statusStyle(session.status));
  const facts = [relativeAge(session.since), ...(session.branch && !session.reviewOf ? [session.branch] : [])];
  return {
    lines: [head + (selected ? style(title, ANSI.bold, ANSI.white) : attention ? style(title, ...statusStyle(session.status)) : title), `  ${status}${style(` · ${facts.join(" · ")}`, ANSI.dim)}`],
    colour: statusStyle(session.status),
    session,
    selected,
  };
}

/** A subagent's box: what it runs as and what it was asked, then whether it is still going. */
function subagentNode(agent: Subagent, parent: Session): Node {
  const busy = agent.status === "busy";
  const colour = busy ? [ANSI.yellow] : [ANSI.dim];
  const title = agent.kind ? `${agent.kind}: ${agent.description}` : agent.description;
  return {
    lines: [`${style(ICON.subagent, ...colour)} ${busy ? title : style(title, ANSI.dim)}`, `  ${style(agent.status, ...colour)}${style(` · ${relativeAge(agent.since)}`, ANSI.dim)}`],
    colour,
    session: parent,
    selected: false,
  };
}

/** Four rows: the border in the node's colour, heavy when selected, content padded inside. `teeAt` puts a tee in the bottom border for a trunk leaving downwards. */
function drawBox({ lines, colour, selected }: Node, width: number, teeAt?: number): string[] {
  const glyph = selected ? HEAVY : LIGHT;
  const inner = width - 4;
  const edge = (text: string) => style(text, ...(selected ? [ANSI.bold, ...colour] : colour));
  const side = edge(glyph.v);
  const content = (line: string) => {
    const text = clip(line, inner);
    return `${side} ${text}${" ".repeat(Math.max(0, inner - visibleLength(text)))} ${side}`;
  };
  const bottom = teeAt === undefined ? glyph.h.repeat(width - 2) : glyph.h.repeat(teeAt - 1) + glyph.tee + glyph.h.repeat(width - 2 - teeAt);
  return [edge(glyph.tl + glyph.h.repeat(width - 2) + glyph.tr), content(lines[0]), content(lines[1] ?? ""), edge(glyph.bl + bottom + glyph.br)];
}

/** What sits between the columns on a row: the arrow out of the parent, the trunk, a branch into each child. */
function connector(row: number, children: number): string {
  if (!children) return " ".repeat(CONNECTOR_WIDTH);
  const lastEntry = (children - 1) * BOX_HEIGHT + ARROW_ROW;
  if (row === ARROW_ROW) return children === 1 ? "───▶" : "─┬─▶";
  if (row > ARROW_ROW && row < lastEntry) return (row - ARROW_ROW) % BOX_HEIGHT === 0 ? " ├─▶" : " │  ";
  if (row === lastEntry) return " └─▶";
  return " ".repeat(CONNECTOR_WIDTH);
}

