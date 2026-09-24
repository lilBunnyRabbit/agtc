import { describe, expect, test } from "bun:test";
import { parseVerdict, reportMessage } from "../src/review/report";
import { session } from "./fixtures";

describe("reportMessage", () => {
  test("names the reviewer's tool", () => {
    const text = reportMessage(session({ tool: "codex" }), "## Findings\n- none");
    expect(text.startsWith("Review findings from a codex reviewer")).toBe(true);
    expect(text.endsWith("- none\n")).toBe(true);
  });
});

describe("parseVerdict", () => {
  test("first bullet under the verdict heading", () => {
    expect(parseVerdict("## Findings\n- none\n\n## Verdict\n- ready\n")).toEqual({ ready: true, text: "ready" });
    expect(parseVerdict("## Verdict\n\n- not ready: the cache is never invalidated\n")).toEqual({ ready: false, text: "not ready: the cache is never invalidated" });
    expect(parseVerdict("## Verdict\nReady, one nit left.")).toEqual({ ready: true, text: "Ready, one nit left." });
    expect(parseVerdict("## Findings\n- a\n")).toBeUndefined();
    expect(parseVerdict("no structure")).toBeUndefined();
  });
});
