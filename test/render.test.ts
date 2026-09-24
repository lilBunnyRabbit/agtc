import { describe, expect, test } from "bun:test";
import { stripAnsi, visibleLength } from "../src/tui/ansi";
import { renderGraph } from "../src/tui/graph";
import { computeLayout } from "../src/tui/layout";
import { initialUiState, renderFrame, renderHeader } from "../src/tui/render";
import { session } from "./fixtures";

const sessions = [
  session({ repo: "acme", status: "done", title: "Settings page safe padding", startedAt: 1, id: "s1", worktree: "feat-a", branch: "feat/a", changes: { paths: ["a.ts", "b.ts"], insertions: 12, deletions: 3, base: "origin/main", ahead: 2 } }),
  session({ repo: "acme", status: "busy", title: "Sidebar header overflow", startedAt: 2, id: "s2", subagents: [{ id: "x", description: "callers of Header", kind: "Explore", status: "busy", since: 5 }] }),
  session({ repo: "acme", tool: "codex", status: "idle", title: "review", startedAt: 3, id: "s3", reviewOf: "s2" }),
  session({ repo: "zeta", status: "needs input", waitingFor: "permission", title: "Chart legend", startedAt: 4, id: "s4", tmux: { paneId: "%3", session: "agtc", windowId: "@2", windowIndex: 2, windowName: "zeta" } }),
  session({ repo: "zeta", status: "inactive", title: "Old one", since: 1, id: "s5" }),
];

describe("renderFrame", () => {
  test("fills the terminal exactly and never overflows a line", () => {
    for (const size of [{ columns: 140, rows: 40 }, { columns: 76, rows: 24 }, { columns: 40, rows: 12 }]) {
      const frame = renderFrame(sessions, initialUiState(true), size);
      expect(frame.lines.length).toBeLessThanOrEqual(size.rows);
      for (const line of frame.lines) expect(visibleLength(line)).toBeLessThanOrEqual(size.columns);
      expect(frame.hits.length).toBeGreaterThan(2);
    }
  });

  test("lists live sessions grouped by repo with a reviewer under its subject", () => {
    const frame = renderFrame(sessions, initialUiState(false), { columns: 120, rows: 30 });
    const text = frame.lines.map(stripAnsi);
    const row = (needle: string) => text.findIndex((line) => line.includes(needle));
    expect(row(" acme ")).toBeLessThan(row("Settings page"));
    expect(row("Sidebar header")).toBeLessThan(row("╰ review"));
    expect(row("╰ review")).toBeLessThan(row(" zeta "));
    expect(row("Old one")).toBe(-1);
    expect(frame.visible.map((s) => s.id)).toEqual(["s1", "s2", "s3", "s4"]);
  });

  test("a reviewer's verdict follows its title and shows in the detail", () => {
    const withVerdict = sessions.map((s) => (s.id === "s3" ? { ...s, status: "idle" as const, verdict: { ready: false, text: "not ready: two bugs" } } : s));
    const ui = { ...initialUiState(false), selected: 2 };
    const text = renderFrame(withVerdict, ui, { columns: 120, rows: 30 }).lines.map(stripAnsi).join("\n");
    expect(text).toContain("review · not ready");
    expect(text).toContain("not ready  not ready: two bugs");
  });

  test("hits map rows back to sessions", () => {
    const frame = renderFrame(sessions, initialUiState(false), { columns: 120, rows: 30 });
    const hitIds = frame.hits.flatMap((row) => row.map((hit) => hit.session.id));
    expect(hitIds).toEqual(["s1", "s2", "s3", "s4"]);
  });

  test("prompt and search footers", () => {
    const ui = { ...initialUiState(false), prompt: { label: "branch", value: "feat/x", choices: ["a"] } };
    const withPrompt = renderFrame(sessions, ui, { columns: 100, rows: 20 });
    expect(stripAnsi(withPrompt.lines.at(-1)!)).toContain("branch: feat/x");
    const searching = renderFrame(sessions, { ...initialUiState(false), searchMode: true, query: "side" }, { columns: 100, rows: 20 });
    expect(stripAnsi(searching.lines.at(-1)!)).toContain("/ side");
    expect(searching.visible.map((s) => s.id)).toEqual(["s2"]);
  });

  test("empty list says so", () => {
    const frame = renderFrame([], initialUiState(false), { columns: 100, rows: 20 });
    expect(frame.lines.map(stripAnsi).some((line) => line.includes("nothing running"))).toBe(true);
  });
});

describe("renderHeader", () => {
  test("shrinks to fit", () => {
    const ui = { query: "", refreshedAt: Date.now() };
    for (const columns of [200, 90, 64]) {
      const header = renderHeader(sessions, sessions, ui, computeLayout({ columns, rows: 10 }));
      expect(visibleLength(header)).toBeLessThanOrEqual(columns);
      expect(stripAnsi(header)).toContain("agtc");
    }
  });
});

describe("renderGraph", () => {
  test("draws a box per live root and never overflows", () => {
    const live = sessions.filter((s) => s.status !== "inactive");
    for (const columns of [200, 120, 60]) {
      const lines = renderGraph(live, computeLayout({ columns, rows: 50 }));
      for (const line of lines) expect(visibleLength(line)).toBeLessThanOrEqual(columns);
      const text = lines.map(stripAnsi).join("\n");
      expect(text).toContain("Settings page");
      expect(text).toContain("◇ Explore: callers of Header");
      expect(text).toContain("▶");
    }
  });

  test("nothing running", () => {
    expect(renderGraph([], computeLayout({ columns: 80, rows: 20 })).map(stripAnsi).join("")).toContain("nothing running");
  });
});
