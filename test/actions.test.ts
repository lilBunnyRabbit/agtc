import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { menuInfo } from "../src/commands/menu";
import type { Session } from "../src/model/session";
import { ACTIONS } from "../src/tui/actions";
import { stripAnsi } from "../src/tui/ansi";
import { helpText } from "../src/tui/help";
import { Key } from "../src/tui/keys";
import { menuActions } from "../src/tui/menu";

const session = { tool: "claude", id: "a41f0c22-rest", status: "idle", title: "fix #12 login", cwd: "/tmp/x" } as Session;
const popupKeys = (from: Partial<Session>) => menuActions(menuInfo({ ...session, ...from } as Session, "~/x", "%7", "%0")).map((action) => action.key);

describe("ACTIONS", () => {
  test("names every key the hub handles, and no other", () => {
    const source = readFileSync(join(import.meta.dir, "../src/tui/app/app.ts"), "utf8");
    const handler = source.slice(source.indexOf("private handleListKey"));
    const aliases: Record<string, string> = { "Key.up": "j", "Key.down": "k", "Key.escape": "/", "Key.enter": Key.enter };
    const handled = [...handler.matchAll(/case (Key\.\w+|"(.)"):/g)].map((match) => match[2] ?? aliases[match[1]]);
    expect(handled).not.toContain(undefined);
    expect(new Set([...handled, "1"])).toEqual(new Set(ACTIONS.map((action) => action.key)));
  });

  test("the reference has a line for each", () => {
    const lines = stripAnsi(helpText()).split("\n");
    for (const { help } of ACTIONS) expect(lines.some((line) => line.includes(help))).toBe(true);
    expect(lines.some((line) => /^\s+x on ╰ review\s+close it/.test(line))).toBe(true);
    expect(lines.some((line) => /^\s+X\s+close it: the agent/.test(line))).toBe(true);
  });

  test("the popup offers what applies to the pane's agent", () => {
    expect(popupKeys({})).toEqual(["V", "X", "c", "n", "e", "o", "v", "J", "K", "a", " "]);
    expect(popupKeys({ status: "done" })).toContain("m");
    expect(popupKeys({ reviewOf: "other" })).toEqual(["V", "x", "c", "n", "e", "o", "v", "J", "K", "a", " "]);
  });
});
