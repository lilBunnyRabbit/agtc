import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { shellQuote, succeeds } from "../lib/shell";
import { agtcShell, tmux } from "../tmux/env";
import { ANSI } from "../tui/ansi";
import type { Ask } from "../tui/app/context";
import { cycleChoice, editPrompt } from "../tui/app/input";
import { renderAsk } from "../tui/ask";
import { Key } from "../tui/keys";
import { MENU_WIDTH } from "../tui/menu";
import type { Prompt } from "../tui/render";
import { openScreen } from "../tui/terminal";
import { popupFrame, popupOver } from "./menu";

interface Question extends Prompt {
  /** Where the answer goes: a popup hands nothing back but its exit code. */
  answer: string;
}

/** Undefined when you left without an answer. A pane that is gone, closed by the answer before, leaves the popup mid-screen. */
export async function askInPopup(pane: string, prompt: Ask): Promise<string | undefined> {
  const question: Question = { ...prompt, value: prompt.value ?? "", answer: join(tmpdir(), `agtc-answer-${randomUUID()}`) };
  const [width, height] = [MENU_WIDTH + 2, renderAsk(question).length + 2];
  const command = `${agtcShell()} ask ${shellQuote(Buffer.from(JSON.stringify(question)).toString("base64url"))}`;
  if (await tmux("display", "-p", "-t", pane, "#{pane_id}")) await popupOver(pane, width, height, command);
  else await succeeds(["tmux", "display-popup", "-E", ...popupFrame(width, height), command]);
  if (!existsSync(question.answer)) return undefined;
  const value = readFileSync(question.answer, "utf8");
  rmSync(question.answer, { force: true });
  return value;
}

export function askScreen(packed: string | undefined): Promise<number> {
  const question = unpack(packed);
  if (!question) {
    console.log("agtc ask runs from agtc: a key from an agent's pane that needs an answer opens it");
    return Promise.resolve(1);
  }
  return new Promise((done) => {
    const draw = () => process.stdout.write(ANSI.clearScreen + renderAsk(question).join("\n"));
    const screen = openScreen({
      onResize: draw,
      onKey: (key) => {
        if (key === Key.up || key === Key.down) cycleChoice(question, key === Key.down ? 1 : -1);
        const outcome = key === Key.up || key === Key.down ? "edited" : editPrompt(question, key);
        if (outcome === "ignored") return;
        if (outcome === "edited") return draw();
        if (outcome === "submit") writeFileSync(question.answer, question.value);
        screen.close();
        done(0);
      },
    });
    draw();
  });
}

function unpack(packed: string | undefined): Question | undefined {
  try {
    const question = JSON.parse(Buffer.from(packed ?? "", "base64url").toString());
    return question?.label && question.answer ? question : undefined;
  } catch {
    return undefined;
  }
}
