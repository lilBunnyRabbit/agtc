import { describe, expect, test } from "bun:test";
import { stripAnsi } from "../src/tui/ansi";
import { renderAsk } from "../src/tui/ask";
import { MENU_WIDTH } from "../src/tui/menu";

const choices = Array.from({ length: 9 }, (_, i) => `~/dev/checkout-${i}`);
const lines = (value: string, label = "new claude in") => renderAsk({ label, value, choices }).map(stripAnsi);

describe("renderAsk", () => {
  test("marks the choice the value names", () => {
    expect(lines(choices[1]).filter((line) => line.includes("▌"))).toEqual([expect.stringContaining("checkout-1")]);
    expect(lines("typed by hand").some((line) => line.includes("▌"))).toBe(false);
  });

  test("keeps its height and width whatever the value", () => {
    const heights = [choices[0], choices[8], "x".repeat(200), "two\nlines"].map((value) => lines(value).length);
    expect(new Set(heights).size).toBe(1);
    expect(Math.max(...lines("x".repeat(200), "close needs input claude \"a title of forty characters, or so\"? (y/N)").map((line) => line.length))).toBeLessThanOrEqual(MENU_WIDTH);
  });

  test("scrolls to a choice past the window", () => {
    expect(lines(choices[8]).some((line) => line.includes("▌ ~/dev/checkout-8"))).toBe(true);
  });

  test("a long value keeps its end", () => {
    expect(lines(`~/${"deep/".repeat(30)}checkout`).some((line) => /^\s+….*checkout▏$/.test(line))).toBe(true);
  });
});
