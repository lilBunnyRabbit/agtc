import { describe, expect, test } from "bun:test";
import { stripAnsi } from "../src/tui/ansi";
import { paint, peekHint, renderPeek } from "../src/tui/peek";

describe("renderPeek", () => {
  test("the end of the screen, the hint on the last line, as many lines as the popup has", () => {
    const lines = renderPeek("one\ntwo\nthree\nfour\n\n\n", 20, 4, peekHint(false)).map(stripAnsi);
    expect(lines).toEqual(["two", "three", "four", " enter goes there  …"]);
    expect(renderPeek("one", 20, 2, "h").map(stripAnsi)[1]).toBe(" h".padEnd(20));
  });

  test("a short screen is padded, a wide line is cut with its colours kept", () => {
    const lines = renderPeek(`\x1b[33m${"x".repeat(30)}\x1b[0m`, 10, 3, "h");
    expect(lines.map(stripAnsi)).toEqual([`${"x".repeat(9)}…`, "", " h".padEnd(10)]);
    expect(lines[0]).toStartWith("\x1b[33m");
  });

  test("painted over what was there, no line left longer than it is now", () => {
    expect(paint(["a", "b"])).toBe("\x1b[Ha\x1b[0m\x1b[K\nb\x1b[0m\x1b[K\x1b[J");
  });
});
