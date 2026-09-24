import { describe, expect, test } from "bun:test";
import { ANSI, clip, stripAnsi, style, visibleLength } from "../src/tui/ansi";

describe("ansi", () => {
  test("style wraps and resets", () => {
    expect(style("x", ANSI.bold, ANSI.cyan)).toBe(`${ANSI.bold}${ANSI.cyan}x${ANSI.reset}`);
  });

  test("stripAnsi and visibleLength ignore escapes", () => {
    const text = style("abc", ANSI.bold) + "de";
    expect(stripAnsi(text)).toBe("abcde");
    expect(visibleLength(text)).toBe(5);
  });

  test("clip keeps escapes and ends with an ellipsis", () => {
    const text = style("abcdef", ANSI.green);
    expect(clip(text, 10)).toBe(text);
    const cut = clip(text, 4);
    expect(visibleLength(cut)).toBe(4);
    expect(stripAnsi(cut)).toBe("abc…");
    expect(cut.startsWith(ANSI.green)).toBe(true);
    expect(cut.endsWith(ANSI.reset)).toBe(true);
  });

  test("clip across several styled parts", () => {
    const text = style("ab", ANSI.bold) + style("cd", ANSI.dim) + "ef";
    expect(stripAnsi(clip(text, 5))).toBe("abcd…");
  });
});
