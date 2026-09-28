import { describe, expect, test } from "bun:test";
import { menuInfo, tmuxCommands } from "../src/commands/menu";
import type { Session } from "../src/model/session";
import { stripAnsi } from "../src/tui/ansi";
import { Key, parsePaneKey } from "../src/tui/keys";
import { MENU_WIDTH, menuActions, moveSelection, renderMenu } from "../src/tui/menu";

const session = { tool: "claude", id: "a41f0c22-rest", status: "idle", title: "fix #12 login", branch: "feat/login", cwd: "/tmp/x" } as Session;
const info = menuInfo(session, "~/x", "%7", "%0");
const commandsOf = (key: string, from = info) => tmuxCommands(from, menuActions(from).find((action) => action.key === key)!, "'bun' 'agtc'");
const typedKey = (command: string[]) => parsePaneKey(command.slice(command.indexOf("-H") + 1).map((byte) => String.fromCharCode(parseInt(byte, 16))).join(""));

describe("tmuxCommands", () => {
  test("an action that asks goes to agtc's pane first, one that does not stays", () => {
    expect(commandsOf("V").map((command) => command[0])).toEqual(["select-window", "select-pane", "send-keys"]);
    expect(commandsOf("m").map((command) => command[0])).toEqual(["send-keys"]);
    expect(typedKey(commandsOf("V")[2])).toEqual({ paneId: "%7", key: "V" });
    expect(typedKey(commandsOf("m")[0])).toEqual({ paneId: "%7", key: "m" });
  });

  test("what opens a popup waits for the menu to close", () => {
    expect(commandsOf("v")).toEqual([["run-shell", "-b", "sleep 0.2; tmux send-keys -t %0 -H 1b 5b 3e 37 3b 31 31 38 7e"]]);
  });

  test("the checkout keys run agtc for the pane", () => {
    expect(commandsOf("e")).toEqual([["run-shell", "-b", "'bun' 'agtc' code --pane %7"]]);
  });
});

describe("menuActions", () => {
  test("a reviewer reports and closes, it is not reviewed", () => {
    const keys = menuActions(menuInfo({ ...session, reviewOf: "other" }, "~/x", "%7", "%0")).map((action) => action.key);
    expect(keys).toContain("x");
    expect(keys).not.toContain("X");
  });

  test("a pane without an agent keeps the checkout and tmux keys", () => {
    expect(menuActions(menuInfo(undefined, "~/x", "%7", "%0")).map((action) => action.key)).toEqual(["e", "o", "a", " "]);
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
    expect(lines.some((line) => /^\s+V\s+review\s+e\s+vscode$/.test(line))).toBe(true);
    expect(Math.max(...lines.map((line) => line.length))).toBeLessThanOrEqual(MENU_WIDTH);
  });
});

describe("moveSelection", () => {
  const walk = (...keys: string[]) => keys.reduce<ReturnType<typeof moveSelection>>((selected, key) => moveSelection(info, selected, key), undefined)?.key;

  test("the first arrow picks the top left, then a column is walked and wraps", () => {
    expect(walk(Key.down)).toBe("V");
    expect(walk(Key.down, Key.down)).toBe("X");
    expect(walk(Key.down, Key.up)).toBe("N");
  });

  test("left and right cross at the same height, or the last row there", () => {
    expect(walk(Key.down, Key.down, Key.right)).toBe("o");
    expect(walk(Key.down, Key.right, Key.up, Key.left)).toBe("N");
  });

  test("the selected row is marked", () => {
    const lines = renderMenu(info, menuActions(info)[1]).map(stripAnsi);
    expect(lines.filter((line) => line.includes("▌"))).toHaveLength(1);
    expect(lines.find((line) => line.includes("▌"))).toContain("close");
  });
});
