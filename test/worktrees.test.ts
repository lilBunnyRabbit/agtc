import { describe, expect, test } from "bun:test";
import { parseWorktreeList } from "../src/worktrees/read";
import { isRemovable, stateOf } from "../src/worktrees/state";

const entry = (overrides = {}) => ({ dir: "/wt/a", head: "abc", branch: "feat/a", bare: false, locked: false, prunable: false, ...overrides });
const input = (overrides = {}) => ({ entry: entry(), missing: false, track: undefined, dirty: 0, ahead: 0, live: false, ...overrides });

describe("parseWorktreeList", () => {
  test("parses porcelain blocks", () => {
    const porcelain = [
      "worktree /main",
      "HEAD 111",
      "branch refs/heads/main",
      "",
      "worktree /wt/a",
      "HEAD 222",
      "branch refs/heads/feat/a",
      "locked",
      "",
      "worktree /wt/b",
      "HEAD 333",
      "detached",
      "prunable gitdir file points to non-existent location",
      "",
    ].join("\n");
    expect(parseWorktreeList(porcelain)).toEqual([
      { dir: "/main", head: "111", branch: "main", bare: false, locked: false, prunable: false },
      { dir: "/wt/a", head: "222", branch: "feat/a", bare: false, locked: true, prunable: false },
      { dir: "/wt/b", head: "333", branch: undefined, bare: false, locked: false, prunable: true },
    ]);
  });
});

describe("stateOf", () => {
  test("precedence: locked, missing, live, dirty", () => {
    expect(stateOf(input({ entry: entry({ locked: true }), missing: true, live: true, dirty: 3 }))).toBe("locked");
    expect(stateOf(input({ missing: true, live: true, dirty: 3 }))).toBe("missing");
    expect(stateOf(input({ live: true, dirty: 3 }))).toBe("live");
    expect(stateOf(input({ dirty: 3 }))).toBe("dirty");
  });

  test("tracked branches: gone, unpushed, pushed", () => {
    expect(stateOf(input({ track: { upstream: "origin/feat/a", gone: true, ahead: 0, committedAt: 0 } }))).toBe("gone");
    expect(stateOf(input({ track: { upstream: "origin/feat/a", gone: false, ahead: 2, committedAt: 0 }, ahead: 2 }))).toBe("unpushed");
    expect(stateOf(input({ track: { upstream: "origin/feat/a", gone: false, ahead: 0, committedAt: 0 } }))).toBe("pushed");
  });

  test("untracked: fresh with no own commits, unpushed with some, detached without a branch", () => {
    expect(stateOf(input({ ahead: 0 }))).toBe("fresh");
    expect(stateOf(input({ ahead: 1 }))).toBe("unpushed");
    expect(stateOf(input({ ahead: NaN }))).toBe("unpushed");
    expect(stateOf(input({ entry: entry({ branch: undefined }), ahead: 1 }))).toBe("detached");
  });
});

describe("isRemovable", () => {
  test("only fresh, gone and missing", () => {
    const removable = ["fresh", "gone", "missing"];
    for (const state of ["live", "dirty", "unpushed", "pushed", "detached", "locked", "fresh", "gone", "missing"] as const) {
      expect(isRemovable({ state } as never)).toBe(removable.includes(state));
    }
  });
});
