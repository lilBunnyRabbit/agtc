import { describe, expect, test } from "bun:test";
import { checkoutIn, withCheckout } from "../src/desktop/vscode";
import { hasDraft } from "../src/tmux/ide";

describe("workspace file", () => {
  test("anchor first, checkout second", () => {
    const text = withCheckout(undefined, "/repo/a", "/anchor");
    expect(JSON.parse(text).folders).toEqual([{ name: "agtc", path: "/anchor" }, { path: "/repo/a" }]);
    expect(checkoutIn(text)).toBe("/repo/a");
  });

  test("a swap keeps what VS Code wrote beside the folders", () => {
    const before = JSON.stringify({ folders: [{ path: "/anchor" }, { path: "/repo/a" }], settings: { "editor.fontSize": 13 } });
    const after = JSON.parse(withCheckout(before, "/repo/b", "/anchor"));
    expect(after.folders[1]).toEqual({ path: "/repo/b" });
    expect(after.settings).toEqual({ "editor.fontSize": 13 });
  });

  test("an unreadable file starts over", () => {
    expect(checkoutIn("{ // comment")).toBeUndefined();
    expect(checkoutIn(withCheckout("{ // comment", "/repo/a", "/anchor"))).toBe("/repo/a");
  });
});

describe("hasDraft", () => {
  test("a dim placeholder is not a draft", () => {
    expect(hasDraft('\x1b[39m❯ \x1b[2mTry "create a util logging.py that..."\x1b[0m')).toBe(false);
    expect(hasDraft("\x1b[39m❯ ")).toBe(false);
  });

  test("typed text is", () => {
    expect(hasDraft("output\n\x1b[39m❯ hello draft\n status line")).toBe(true);
  });
});
