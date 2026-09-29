import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { shellQuote } from "../lib/shell";
import { truncate } from "../lib/text";
import type { Session } from "../model/session";
import { readClaudeRegistry } from "../sources/claude/registry";
import { agtcShell, tmux } from "../tmux/env";
import { Key } from "../tui/keys";
import { type PeekInfo, type PeekOutcome, paint, peekHint, renderPeek } from "../tui/peek";
import { openScreen } from "../tui/terminal";
import { STATUS_LABEL } from "../tui/theme";
import { popupBehind, popupFrame } from "./menu";

const REFRESH_MS = 250;
const SETTLED_MS = 900;
const TITLE_WIDTH = 50;
const MAX_HEIGHT_SHARE = 0.8;
const ANSWER_BORDER = "fg=magenta,bold";
const LOOK_BORDER = "fg=brightwhite,bold";
const NO_WRAP = "\x1b[?7l";
const WRAP = "\x1b[?7h";

const numbers = (text: string) => text.split(" ").map(Number);

export async function peekInPopup(over: string, session: Session): Promise<PeekOutcome | undefined> {
  const pane = session.tmux?.paneId;
  if (!pane) return undefined;
  const [paneWidth, paneHeight] = numbers(await tmux("display", "-p", "-t", pane, "#{pane_width} #{pane_height}"));
  const [width, height] = numbers(await tmux("display", "-p", "-t", over, "#{window_width} #{window_height}"));
  if (!paneWidth || !width) return undefined;
  const { id, title, status, tool } = session;
  const info: PeekInfo = { pane, id, title, status, tool, answers: status === "needs input", outcome: join(tmpdir(), `agtc-peek-${randomUUID()}`) };
  const border = info.answers ? ANSWER_BORDER : LOOK_BORDER;
  const size = popupFrame(Math.min(paneWidth + 2, width), Math.min(paneHeight + 3, Math.floor(height * MAX_HEIGHT_SHARE)), border);
  const heading = `#[${border},reverse] ${truncate(title, TITLE_WIDTH).replaceAll("#", "##")} · ${STATUS_LABEL[status]} #[default]`;
  const command = `${agtcShell()} peek ${shellQuote(Buffer.from(JSON.stringify(info)).toString("base64url"))}`;
  await popupBehind(over, [...size, "-T", heading, command]);
  if (!existsSync(info.outcome)) return undefined;
  const outcome = readFileSync(info.outcome, "utf8") as PeekOutcome;
  rmSync(info.outcome, { force: true });
  return outcome;
}

/** Read fresh before every key: a key typed into an agent that stopped asking would land in its input. */
const stillWaits = ({ id }: PeekInfo) => readClaudeRegistry().some((registration) => registration.sessionId === id && registration.waitingFor);

const hexOf = (key: string) => [...Buffer.from(key)].map((byte) => byte.toString(16));

function capture(pane: string): string | undefined {
  const { exitCode, stdout } = Bun.spawnSync(["tmux", "capture-pane", "-p", "-e", "-t", pane], { stderr: "ignore" });
  return exitCode === 0 ? stdout.toString() : undefined;
}

export function peekScreen(packed: string | undefined): Promise<number> {
  const info = unpack(packed);
  if (!info) {
    console.log("agtc peek runs from agtc: space on a row shows that agent's screen");
    return Promise.resolve(1);
  }
  return new Promise((done) => {
    let typed = false;
    let settled = false;
    const out = process.stdout;
    const leave = (outcome?: PeekOutcome) => {
      clearInterval(timer);
      if (outcome) writeFileSync(info.outcome, outcome);
      out.write(WRAP);
      screen.close();
      done(0);
    };
    const draw = () => {
      const captured = capture(info.pane);
      if (captured === undefined) return leave();
      out.write(paint(renderPeek(captured, out.columns, out.rows, peekHint(info.answers, settled), info.answers)));
    };
    const settle = () => {
      if (settled) return;
      settled = true;
      setTimeout(() => leave(typed ? "answered" : undefined), SETTLED_MS);
    };
    const screen = openScreen({
      onResize: draw,
      onKey: (key) => {
        if (key === Key.escape || key === Key.ctrlC) return leave(typed ? "answered" : undefined);
        if (!info.answers) {
          if (key === "q") leave();
          if (key === Key.enter) leave("go");
          return;
        }
        if (settled) return;
        if (!stillWaits(info)) return settle();
        typed = true;
        Bun.spawnSync(["tmux", "send-keys", "-t", info.pane, "-H", ...hexOf(key)]);
        draw();
      },
    });
    out.write(NO_WRAP);
    const timer = setInterval(() => {
      if (info.answers && typed && !settled && !stillWaits(info)) settle();
      draw();
    }, REFRESH_MS);
    draw();
  });
}

function unpack(packed: string | undefined): PeekInfo | undefined {
  try {
    const info = JSON.parse(Buffer.from(packed ?? "", "base64url").toString());
    return info?.pane && info.outcome ? info : undefined;
  } catch {
    return undefined;
  }
}
