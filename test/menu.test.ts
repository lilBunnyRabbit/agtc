import { describe, expect, test } from "bun:test";
import { menuInfo, otherAgents, tmuxCommands } from "../src/commands/menu";
import type { Session } from "../src/model/session";
import { stripAnsi } from "../src/tui/ansi";
import { Key, parsePaneKey } from "../src/tui/keys";
import { MENU_WIDTH, menuActions, moveSelection, renderMenu } from "../src/tui/menu";

const session = { tool: "claude", id: "a41f0c22-rest", status: "idle", title: "fix #12 login", branch: "feat/login", cwd: "/tmp/x" } as Session;
const info = menuInfo(session, "~/x", "%7", "%0");
const waiting = { ...session, id: "b", status: "needs input", title: "wants an answer" } as Session;
const finished = { ...session, id: "c", status: "done", title: "all done" } as Session;
const crowded = menuInfo(session, "~/x", "%7", "%0", otherAgents([waiting, session, finished], waiting));
const commandsOf = (key: string, from = info) => tmuxCommands(from, menuActions(from).find((action) => action.key === key)!, "'bun' 'agtc'");
const typedKey = (command: string[]) => parsePaneKey(command.slice(command.indexOf("-H") + 1).map((byte) => String.fromCharCode(parseInt(byte, 16))).join(""));

describe("tmuxCommands", () => {
  test("a key is typed into agtc and you stay in the pane", () => {
    expect(commandsOf("x", menuInfo({ ...session, reviewOf: "other" }, "~/x", "%7", "%0")).map((command) => command[0])).toEqual(["send-keys"]);
    expect(typedKey(commandsOf("x", menuInfo({ ...session, reviewOf: "other" }, "~/x", "%7", "%0"))[0])).toEqual({ paneId: "%7", key: "x" });
  });

  test("what opens a popup waits for the menu to close, a question too", () => {
    expect(commandsOf("v")).toEqual([["run-shell", "-b", "sleep 0.2; tmux send-keys -t %0 -H 1b 5b 3e 37 3b 31 31 38 7e"]]);
    for (const key of ["V", "X"]) expect(commandsOf(key)[0][2]).toStartWith("sleep 0.2; tmux send-keys -t %0 -H");
  });

  test("a digit goes to agtc as typed there", () => {
    expect(commandsOf("3", crowded)).toEqual([["select-window", "-t", "%0"], ["send-keys", "-t", "%0", "3"]]);
  });

  test("the checkout keys run agtc for the pane", () => {
    expect(commandsOf("o")).toEqual([["run-shell", "-b", "'bun' 'agtc' edit --pane %7"]]);
  });
});

describe("menuActions", () => {
  test("a reviewer reports and closes, it is not reviewed", () => {
    const keys = menuActions(menuInfo({ ...session, reviewOf: "other" }, "~/x", "%7", "%0")).map((action) => action.key);
    expect(keys).toContain("x");
    expect(keys).not.toContain("X");
  });

  test("a pane without an agent keeps the checkout and tmux keys", () => {
    expect(menuActions(menuInfo(undefined, "~/x", "%7", "%0")).map((action) => action.key)).toEqual(["o", " "]);
  });

  test("no key twice", () => {
    const keys = menuActions(info).map((action) => action.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("renderMenu", () => {
  test("names the session and fits the popup", () => {
    const lines = renderMenu(info).map(stripAnsi);
    expect(lines.join("\n")).toContain("fix #12 login");
    expect(lines.join("\n")).toContain("claude  a41f0c22  idle  feat/login");
    expect(lines.some((line) => /^\s+V\s+review\s+o\s+editor$/.test(line))).toBe(true);
    expect(Math.max(...lines.map((line) => line.length))).toBeLessThanOrEqual(MENU_WIDTH);
  });
});

describe("otherAgents", () => {
  test("the pane's own agent is left out, the digits stay the hub's", () => {
    expect(crowded.others).toEqual([{ title: "fix #12 login", status: "idle", digit: "2" }, { title: "all done", status: "done", digit: "3" }]);
  });

  test("each is listed with its digit as a key", () => {
    expect(menuActions(crowded).map((action) => action.key)).toContain("3");
    const lines = renderMenu(crowded).map(stripAnsi);
    expect(lines.some((line) => /^\s+3\s+done\s+all done$/.test(line))).toBe(true);
    expect(Math.max(...lines.map((line) => line.length))).toBeLessThanOrEqual(MENU_WIDTH);
  });
});

describe("moveSelection", () => {
  const walk = (...keys: string[]) => keys.reduce<ReturnType<typeof moveSelection>>((selected, key) => moveSelection(info, selected, key), undefined)?.key;

  test("the first arrow picks the top left, then a column is walked and wraps", () => {
    expect(walk(Key.down)).toBe("V");
    expect(walk(Key.down, Key.down)).toBe("X");
    expect(walk(Key.down, Key.up)).toBe("X");
  });

  test("left and right cross at the same height, or the last row there", () => {
    expect(walk(Key.down, Key.down, Key.right)).toBe("v");
    expect(walk(Key.down, Key.right, Key.up, Key.left)).toBe("X");
  });

  test("the selected row is marked", () => {
    const lines = renderMenu(info, menuActions(info)[1]).map(stripAnsi);
    expect(lines.filter((line) => line.includes("▌"))).toHaveLength(1);
    expect(lines.find((line) => line.includes("▌"))).toContain("close");
  });
});
