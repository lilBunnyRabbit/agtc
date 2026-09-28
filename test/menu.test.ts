import { describe, expect, test } from "bun:test";
import { menuHeader, menuItems } from "../src/commands/menu";
import type { Session } from "../src/model/session";
import { paneKey, parsePaneKey } from "../src/tui/keys";

const place = { pane: "%7", hub: "%0", self: "'bun' 'agtc'" };
const session = { tool: "claude", id: "a41f0c22-rest", status: "idle", title: "fix #12 login", branch: "feat/login", cwd: "/tmp/x" } as Session;

const typedKey = (command: string) => {
  const bytes = command.match(/send-keys -t %0 -H (.+)$/)?.[1].split(" ") ?? [];
  return parsePaneKey(bytes.map((byte) => String.fromCharCode(parseInt(byte, 16))).join(""));
};
const commandOf = (items: string[][], key: string) => items.find((item) => item[1] === key)?.[2] ?? "";

describe("menuItems", () => {
  test("an action that asks goes to agtc's pane first, one that does not stays", () => {
    const items = menuItems(session, place);
    expect(commandOf(items, "V")).toStartWith("select-window -t %0 ; select-pane -Z -t %0 ; send-keys");
    expect(commandOf(items, "m")).toStartWith("send-keys");
    expect(typedKey(commandOf(items, "V"))).toEqual({ paneId: "%7", key: "V" });
    expect(typedKey(commandOf(items, "m"))).toEqual({ paneId: "%7", key: "m" });
    expect(paneKey({ paneId: "%7", key: "m" })).toContain("7;109");
  });

  test("the checkout keys run agtc for the pane", () => {
    expect(commandOf(menuItems(session, place), "e")).toBe(`run-shell -b "'bun' 'agtc' code --pane %7"`);
  });

  test("a reviewer reports and closes, it is not reviewed", () => {
    const keys = menuItems({ ...session, reviewOf: "other" }, place).map((item) => item[1]);
    expect(keys).toContain("x");
    expect(keys).not.toContain("X");
  });

  test("a pane without an agent keeps the checkout and tmux keys", () => {
    expect(menuItems(undefined, place).map((item) => item[1]).filter(Boolean)).toEqual(["e", "o", "a", "Space"]);
  });
});

describe("menuHeader", () => {
  test("names the session, with # kept from tmux", () => {
    const { title, lines } = menuHeader(session, "~/x");
    expect(title).toContain(" fix ##12 login ");
    expect(lines[0][0].replace(/#\[[^\]]*\]/g, "")).toBe("-claude  a41f0c22  idle  feat/login");
    expect(lines[0][0]).toContain("#[fg=green]idle");
    expect(lines[1][0]).toEndWith("~/x");
  });
});
