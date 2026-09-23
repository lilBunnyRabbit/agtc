import type { Options } from "../cli";
import { relativeAge } from "../lib/time";
import { STATE_FILE } from "../paths";
import { SeenStore } from "../seen-store";
import type { Session, Subagent } from "../session";
import { collectSessions } from "../sessions";
import { ANSI, clip, style, visibleLength } from "./ansi";
import { Key, splitKeys } from "./keys";
import { type Layout, computeLayout, terminalSize } from "./layout";
import { renderHeader } from "./render";
import { repoRule } from "./rows";
import { ICON, STATUS_LABEL, needsAttention, statusStyle, toolIcon, worktreeIcon } from "./theme";

/*
 * `agtc graph`: every running session a box, what it spawned in boxes to its right, arrows
 * between them. Like a CI pipeline, read left to right. An overview to leave on a screen:
 * it redraws as things change and takes no key but q.
 *
 *   ┌──────────────────────────────┐    ┌──────────────────────────────┐    ┌──────────────────────────────┐
 *   │ ✳ ⎇  Transitions.dev anim…   │─┬─▶│ ⬡ review                     │    │ ✳ Settings page padding      │
 *   │   idle · 5m · feat/motion    │ │  │   busy · 4m                  │    │   busy · 2m · main           │
 *   └──────────────────────────────┘ │  └──────────────────────────────┘    └──────────────────────────────┘
 *                                    │  ┌──────────────────────────────┐
 *                                    └─▶│ ◇ Explore: callers of Header │
 *                                       │   busy · 1m                  │
 *                                       └──────────────────────────────┘
 *
 * The border takes the status colour. A session and its children make a family; families
 * flow across the width, as many per row as fit, so a full screen holds them all. A pane too
 * narrow for two boxes side by side hangs the children under their parent.
 */

const MARGIN = " ";
const MIN_BOX_WIDTH = 26;
/** Boxes grow to this before another column of families opens. */
const PREFERRED_BOX_WIDTH = 52;
const MAX_BOX_WIDTH = 60;
/** Rows of one box: two borders, two lines. */
const BOX_HEIGHT = 4;
/** The row of a box an arrow leaves from and arrives at. */
const ARROW_ROW = 1;
/** Between a parent and its children, where the arrow runs, and between one family and the next. */
const GAP_WIDTH = 4;
/** Narrow mode: the trunk under the parent and the arrow into each child. */
const HANG_WIDTH = 5;
/** Header and the blank line under it. */
const HEADER_LINES = 2;

const BOX = { tl: "┌", tr: "┐", bl: "└", br: "┘", h: "─", v: "│", tee: "┬" };

interface Node {
  /** Two lines of content, unpadded. */
  lines: string[];
  colour: string[];
}

/** A session with its children drawn: what one row of the graph is made of. */
interface Block {
  width: number;
  lines: string[];
}

/** The graph alone, polled and redrawn until q, escape or ctrl-c. */
export function watchGraph(options: Options): void {
  const out = process.stdout;
  let sessions: Session[] = [];
  let refreshedAt = Date.now();
  let refreshing = false;

  const draw = () => {
    const size = terminalSize();
    const layout = computeLayout(size);
    const live = sessions.filter((s) => s.status !== "inactive");
    const room = Math.max(1, size.rows - HEADER_LINES);
    const body = renderGraph(live, layout);
    const shown = body.length > room ? [...body.slice(0, room - 1), style(`${MARGIN}…`, ANSI.dim)] : body;
    out.write(ANSI.clearScreen + [renderHeader(sessions, live, { query: "", refreshedAt }, layout), "", ...shown].join("\n"));
  };
  const refresh = async () => {
    if (refreshing) return;
    refreshing = true;
    try {
      // Loaded every poll: the hub owns the file, and its marks turn done into idle here too.
      sessions = await collectSessions({ days: options.days, seen: SeenStore.load(STATE_FILE, { readOnly: true }) });
      refreshedAt = Date.now();
      draw();
    } finally {
      refreshing = false;
    }
  };

  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk: string) => {
    for (const key of splitKeys(chunk)) if (key === "q" || key === Key.escape || key === Key.ctrlC) process.exit(0);
  });
  out.write(ANSI.altScreenOn + ANSI.hideCursor);
  process.on("exit", () => out.write(ANSI.showCursor + ANSI.altScreenOff));
  process.on("SIGINT", () => process.exit(0));
  process.on("SIGTERM", () => process.exit(0));
  out.on("resize", draw);

  draw();
  void refresh();
  setInterval(() => void refresh(), options.intervalMs);
}

export function renderGraph(live: Session[], layout: Layout): string[] {
  const lines: string[] = [];
  const ids = new Set(live.map((s) => s.id));
  const roots = live.filter((s) => !s.reviewOf || !ids.has(s.reviewOf));
  const childrenOf = (root: Session): Node[] => [...live.filter((s) => s.reviewOf === root.id).map(sessionNode), ...(root.subagents ?? []).map(subagentNode)];
  const slots = Math.max(1, Math.floor((layout.columns - MARGIN.length + GAP_WIDTH) / (PREFERRED_BOX_WIDTH + GAP_WIDTH)));
  const hang = slots === 1 && roots.some((root) => childrenOf(root).length);
  const boxWidth = Math.max(
    MIN_BOX_WIDTH,
    Math.min(MAX_BOX_WIDTH, Math.floor((layout.columns - MARGIN.length - (slots - 1) * GAP_WIDTH) / slots) - (hang ? HANG_WIDTH : 0)),
  );

  let currentRepo: string | undefined;
  let row: Block[] = [];
  let used = 0;
  let rowsInRepo = 0;
  const flush = () => {
    if (!row.length) return;
    if (rowsInRepo++) lines.push("");
    const height = Math.max(...row.map((block) => block.lines.length));
    for (let r = 0; r < height; r++) lines.push(MARGIN + row.map((block) => block.lines[r] ?? " ".repeat(block.width)).join(" ".repeat(GAP_WIDTH)));
    row = [];
    used = 0;
  };

  for (const root of roots) {
    if (root.repo !== currentRepo) {
      flush();
      currentRepo = root.repo;
      rowsInRepo = 0;
      if (lines.length) lines.push("");
      lines.push(repoRule(root.repo, live.filter((s) => s.repo === currentRepo), layout));
    }
    const children = childrenOf(root);
    const need = children.length && !hang ? 2 : 1;
    if (used + need > slots) flush();
    row.push(familyBlock(sessionNode(root), children, boxWidth, hang));
    used += need;
  }
  flush();

  if (!live.length) lines.push(style("   nothing running", ANSI.dim));
  return lines;
}

/** The parent box with its children beside it, arrows between; or, when hanging, under it off a trunk. */
function familyBlock(parent: Node, children: Node[], boxWidth: number, hang: boolean): Block {
  const parentBox = drawBox(parent, boxWidth, hang && children.length ? HANG_WIDTH - 2 : undefined);
  if (!children.length) return { width: boxWidth, lines: parentBox };
  const childBoxes = children.map((child) => drawBox(child, boxWidth));
  if (hang) {
    const lines = [...parentBox];
    childBoxes.forEach((box, i) => {
      const last = i === children.length - 1;
      box.forEach((line, row) => {
        const lead = row === ARROW_ROW ? (last ? "   └▶" : "   ├▶") : last && row > ARROW_ROW ? "     " : "   │ ";
        lines.push(style(lead, ANSI.dim) + line);
      });
    });
    return { width: HANG_WIDTH + boxWidth, lines };
  }
  const lines = Array.from(
    { length: children.length * BOX_HEIGHT },
    (_, row) => (parentBox[row] ?? " ".repeat(boxWidth)) + style(connector(row, children.length), ANSI.dim) + childBoxes[Math.floor(row / BOX_HEIGHT)][row % BOX_HEIGHT],
  );
  return { width: boxWidth * 2 + GAP_WIDTH, lines };
}

/** A session's box: its tool, worktree and title, then status, age and branch. */
function sessionNode(session: Session): Node {
  const attention = needsAttention(session.status);
  const head = `${toolIcon(session.tool)} ${session.worktree && !session.reviewOf ? `${worktreeIcon()}  ` : ""}`;
  const title = session.reviewOf ? "review" : session.title;
  const status = attention
    ? style(` ${STATUS_LABEL[session.status]} `, ...statusStyle(session.status), ANSI.reverse)
    : style(STATUS_LABEL[session.status], ...statusStyle(session.status));
  const facts = [relativeAge(session.since), ...(session.branch && !session.reviewOf ? [session.branch] : [])];
  return {
    lines: [head + (attention ? style(title, ...statusStyle(session.status)) : title), `  ${status}${style(` · ${facts.join(" · ")}`, ANSI.dim)}`],
    colour: statusStyle(session.status),
  };
}

/** A subagent's box: what it runs as and what it was asked, then whether it is still going. */
function subagentNode(agent: Subagent): Node {
  const busy = agent.status === "busy";
  const colour = busy ? [ANSI.yellow] : [ANSI.dim];
  const title = agent.kind ? `${agent.kind}: ${agent.description}` : agent.description;
  return {
    lines: [`${style(ICON.subagent, ...colour)} ${busy ? title : style(title, ANSI.dim)}`, `  ${style(agent.status, ...colour)}${style(` · ${relativeAge(agent.since)}`, ANSI.dim)}`],
    colour,
  };
}

/** Four rows: the border in the node's colour, content padded inside. `teeAt` puts a tee in the bottom border for a trunk leaving downwards. */
function drawBox({ lines, colour }: Node, width: number, teeAt?: number): string[] {
  const inner = width - 4;
  const edge = (text: string) => style(text, ...colour);
  const side = edge(BOX.v);
  const content = (line: string) => {
    const text = clip(line, inner);
    return `${side} ${text}${" ".repeat(Math.max(0, inner - visibleLength(text)))} ${side}`;
  };
  const bottom = teeAt === undefined ? BOX.h.repeat(width - 2) : BOX.h.repeat(teeAt - 1) + BOX.tee + BOX.h.repeat(width - 2 - teeAt);
  return [edge(BOX.tl + BOX.h.repeat(width - 2) + BOX.tr), content(lines[0]), content(lines[1] ?? ""), edge(BOX.bl + bottom + BOX.br)];
}

/** What sits between the columns on a row: the arrow out of the parent, the trunk, a branch into each child. */
function connector(row: number, children: number): string {
  if (!children) return " ".repeat(GAP_WIDTH);
  const lastEntry = (children - 1) * BOX_HEIGHT + ARROW_ROW;
  if (row === ARROW_ROW) return children === 1 ? "───▶" : "─┬─▶";
  if (row > ARROW_ROW && row < lastEntry) return (row - ARROW_ROW) % BOX_HEIGHT === 0 ? " ├─▶" : " │  ";
  if (row === lastEntry) return " └─▶";
  return " ".repeat(GAP_WIDTH);
}
