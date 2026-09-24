import { Key, isPrintable } from "../keys";
import type { Prompt } from "../render";
import type { AppContext } from "./context";

export function editPrompt(prompt: Prompt, key: string): "edited" | "submit" | "cancel" | "ignored" {
  switch (key) {
    case Key.escape:
      return "cancel";
    case Key.enter:
      return "submit";
    case Key.backspace:
    case Key.backspaceAlt:
      prompt.value = prompt.value.slice(0, -1);
      return "edited";
    case Key.ctrlU:
      prompt.value = "";
      return "edited";
    case Key.tab:
    case Key.shiftTab:
      cycleChoice(prompt, key === Key.tab ? 1 : -1);
      return "edited";
    default:
      if (!isPrintable(key)) return "ignored";
      prompt.value += key;
      return "edited";
  }
}

/** Tab walks the choices; a value typed by hand starts over from the first (or last). */
export function cycleChoice(prompt: Prompt, step: number): void {
  const { choices, value } = prompt;
  if (!choices?.length) return;
  const at = choices.indexOf(value);
  prompt.value = at < 0 && step < 0 ? choices[choices.length - 1] : choices[(at + step + choices.length) % choices.length];
}

export function searchKey(ctx: AppContext, key: string): boolean {
  const { ui } = ctx;
  switch (key) {
    case Key.escape:
      ui.query = "";
      ui.searchMode = false;
      return true;
    case Key.enter:
      ui.searchMode = false;
      return true;
    case Key.backspace:
    case Key.backspaceAlt:
      ui.query = ui.query.slice(0, -1);
      return true;
    case Key.ctrlU:
      ui.query = "";
      return true;
    case Key.up:
      ui.selected--;
      return true;
    case Key.down:
      ui.selected++;
      return true;
    default:
      if (!isPrintable(key)) return false;
      ui.query += key;
      return true;
  }
}
