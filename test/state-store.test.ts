import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StateStore } from "../src/model/state-store";

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "agtc-state-"));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("StateStore", () => {
  test("fresh until saved, marks never move backwards, persists", () => {
    const path = join(dir, "state.json");
    const store = StateStore.load(path);
    expect(store.isFresh).toBe(true);
    store.mark("a", 100);
    store.mark("a", 50);
    expect(store.seenAt("a")).toBe(100);
    expect(store.isFresh).toBe(false);
    store.markOpened("/checkout", "a");
    const again = StateStore.load(path);
    expect(again.isFresh).toBe(false);
    expect(again.seenAt("a")).toBe(100);
    expect(again.openedIn("/checkout")).toBe("a");
  });

  test("read-only stores never write", () => {
    const path = join(dir, "ro.json");
    const store = StateStore.load(path, { readOnly: true });
    store.mark("a");
    expect(existsSync(path)).toBe(false);
  });

  test("hub windows: empty sets are not recorded", () => {
    const store = StateStore.load(join(dir, "hub.json"));
    const windows = [{ id: "a", tool: "claude" as const, cwd: "/x", name: "x" }];
    store.rememberHub(windows);
    store.rememberHub([]);
    expect(store.lastHub()).toEqual(windows);
  });

  test("review links match by id, then by pane after the start time, and settle the id", () => {
    const store = StateStore.load(join(dir, "reviews.json"));
    store.rememberReview({ pane: "%5", of: "subject", at: 10_000 });
    expect(store.reviewLinkOf({ id: "early", tmux: { paneId: "%5" }, startedAt: 1_000 })).toBeUndefined();
    const link = store.reviewLinkOf({ id: "reviewer", tmux: { paneId: "%5" }, startedAt: 12_000 });
    expect(link?.of).toBe("subject");
    expect(link?.id).toBe("reviewer");
    expect(store.reviewLinkOf({ id: "reviewer" })?.of).toBe("subject");
    expect(store.reviewLinkOf({ id: "other", tmux: { paneId: "%5" }, startedAt: 12_000 })).toBeUndefined();
  });

  test("a codex placeholder id does not settle the link", () => {
    const store = StateStore.load(join(dir, "codex.json"));
    store.rememberReview({ pane: "%7", of: "subject", at: 10_000 });
    const link = store.reviewLinkOf({ id: "pid-123", tmux: { paneId: "%7" }, startedAt: 12_000 });
    expect(link?.of).toBe("subject");
    expect(link?.id).toBeUndefined();
  });

  test("a new link in the same pane replaces one still waiting for its id", () => {
    const store = StateStore.load(join(dir, "replace.json"));
    store.rememberReview({ pane: "%9", of: "one", at: 10_000 });
    store.rememberReview({ pane: "%9", of: "two", at: 20_000 });
    expect(store.reviewLinkOf({ id: "r", tmux: { paneId: "%9" }, startedAt: 21_000 })?.of).toBe("two");
  });
});
