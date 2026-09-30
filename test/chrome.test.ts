import { describe, expect, test } from "bun:test";
import { Chrome, paneHeader } from "../src/tmux/chrome";
import { session } from "./fixtures";

const pane = (paneId: string, windowId: string) => ({ paneId, windowId, session: "agtc", windowIndex: 1, windowName: "x" });
const waiting = session({ status: "needs input", waitingFor: "approve Bash", title: "fix #12 login", branch: "feat/login", tmux: pane("%7", "@3") });
const working = session({ status: "busy", title: "refactor", worktree: "feat+x", changes: { paths: ["a.ts"], insertions: 12, deletions: 3 }, tmux: pane("%8", "@3") });
const plainText = (format: string) => format.replace(/#\[[^\]]*\]/g, "").replace("#{?pane_active,,}", "");

describe("paneHeader", () => {
  test("status and title on the left, where and what changed on the right, a # in the title stays a #", () => {
    expect(plainText(paneHeader(waiting))).toBe(" ✳ input · fix ##12 login · approve Bash  feat/login ");
    expect(plainText(paneHeader(working))).toBe(" ⎇ ✳ busy · refactor  feat+x · +12 −3 ");
    expect(paneHeader(working)).toMatch(/#\[align=left\].*busy.*#\[align=right\].*feat\+x/);
  });
});

describe("Chrome", () => {
  test("a poll that changed nothing sends nothing, a new status sends the header", () => {
    const chrome = new Chrome("%0");
    const first = chrome.changes([waiting, working]);
    expect(first.filter((command) => command.includes("pane-border-status")).map((command) => command[3])).toEqual(["%0", "@3"]);
    expect(first.filter((command) => command[1] === "-p").map((command) => command[3])).toEqual(["%0", "%7", "%8"]);
    expect(chrome.changes([waiting, working])).toEqual([]);
    const next = chrome.changes([{ ...waiting, status: "busy" }, working]);
    expect(next.map((command) => command[3])).toEqual(["%7"]);
  });
});
