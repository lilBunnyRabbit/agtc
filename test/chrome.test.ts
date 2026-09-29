import { describe, expect, test } from "bun:test";
import { Chrome, paneHeader, statusRight } from "../src/tmux/chrome";
import { statusClick } from "../src/tmux/setup";
import { session } from "./fixtures";

const pane = (paneId: string, windowId: string) => ({ paneId, windowId, session: "agtc", windowIndex: 1, windowName: "x" });
const waiting = session({ status: "needs input", waitingFor: "approve Bash", title: "fix #12 login", branch: "feat/login", tmux: pane("%7", "@3") });
const finished = session({ status: "done", title: "a title far longer than the status line has room for" });
const working = session({ status: "busy", title: "refactor", worktree: "feat+x", changes: { paths: ["a.ts"], insertions: 12, deletions: 3 }, tmux: pane("%8", "@3") });
const plainText = (format: string) => format.replace(/#\[[^\]]*\]/g, "");

describe("paneHeader", () => {
  test("says what waits instead of the checkout, and a # in the title stays a #", () => {
    expect(plainText(paneHeader(waiting))).toBe("✳ input · fix ##12 login · approve Bash");
    expect(plainText(paneHeader(working))).toBe("✳ busy · refactor · feat+x · +12 −3");
  });
});

describe("statusRight", () => {
  test("the hub's digits, each in a range of its own, then who works", () => {
    const line = statusRight([waiting, finished], [waiting, finished, working]);
    expect(plainText(line)).toBe(" 1 fix ##12 login   2 a title far longe…  1 busy ");
    expect(line).toContain("#[range=user|d2]");
  });

  test("past five the rest is a count", () => {
    const many = Array.from({ length: 7 }, () => finished);
    expect(plainText(statusRight(many, many))).toEndWith(" +2 ");
  });
});

describe("Chrome", () => {
  test("a poll that changed nothing sends nothing, a new status sends the header and the line", () => {
    const chrome = new Chrome("%0");
    const first = chrome.changes([waiting, working], [waiting]);
    expect(first.filter((command) => command.includes("pane-border-status")).map((command) => command[3])).toEqual(["%0", "@3"]);
    expect(first.filter((command) => command[1] === "-p").map((command) => command[3])).toEqual(["%0", "%7", "%8"]);
    expect(chrome.changes([waiting, working], [waiting])).toEqual([]);
    const next = chrome.changes([{ ...waiting, status: "busy" }, working], []);
    expect(next.map((command) => command[3])).toEqual(["status-right", "%7"]);
  });
});

describe("statusClick", () => {
  test("types the digit into the hub, leaves every other click to tmux", () => {
    expect(statusClick("%0")).toContain("tmux send-keys -t %0 #{s/d//:mouse_status_range}");
    expect(statusClick("%0")).toEndWith("{ switch-client -t = }");
  });
});
