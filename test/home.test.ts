import { describe, expect, test } from "bun:test";
import { visibleLength } from "../src/tui/ansi";
import { HOME_WIDTH, type HomeInfo, PASTE_END, PASTE_START, homeChoice, homeKey, renderHome } from "../src/tui/home";
import { Key, splitKeys } from "../src/tui/keys";

const form = (over: Partial<HomeInfo> = {}): HomeInfo => ({
  start: "claude",
  dir: "~/dev/a",
  dirs: ["~/dev/a", "~/dev/b"],
  message: "",
  field: "message",
  answer: "/tmp/x",
  ...over,
});

const type = (info: HomeInfo, keys: string[]) => keys.map((key) => homeKey(info, key));

describe("home form", () => {
  test("types a message over several lines", () => {
    const info = form();
    type(info, [..."fix it", "\n", ..."then test", Key.altEnter, "x", Key.backspace]);
    expect(info.message).toBe("fix it\nthen test\n");
  });

  test("an enter inside a paste is a line, outside it starts", () => {
    const info = form();
    expect(type(info, [PASTE_START, "a", Key.enter, "b", PASTE_END, Key.enter])).toEqual(["ignored", "edited", "edited", "edited", "ignored", "submit"]);
    expect(info.message).toBe("a\nb");
  });

  test("arrows walk the fields and skip the message for a terminal", () => {
    const info = form({ field: "start" });
    type(info, [Key.left]);
    expect(info.start).toBe("terminal");
    type(info, [Key.down, Key.down]);
    expect(info.field).toBe("start");
  });

  test("tab walks the checkouts in where", () => {
    const info = form({ field: "dir" });
    type(info, [Key.tab]);
    expect(info.dir).toBe("~/dev/b");
  });

  test("a terminal drops the message", () => {
    expect(homeChoice(form({ start: "terminal", message: "hi" }))).toEqual({ start: "terminal", dir: "~/dev/a", message: "" });
    expect(homeChoice(form({ message: "  hi \n" })).message).toBe("hi");
  });

  test("keeps its height and width whatever is typed", () => {
    const heights = ["", "x".repeat(500), "a\n".repeat(20)].map((message) => renderHome(form({ message })).length);
    expect(new Set([...heights, renderHome(form({ start: "terminal" })).length]).size).toBe(1);
    const lines = renderHome(form({ message: "y".repeat(500), dir: `~/${"deep/".repeat(40)}x` }));
    expect(Math.max(...lines.map(visibleLength))).toBeLessThanOrEqual(HOME_WIDTH);
  });

  test("option-enter arrives as one key", () => {
    expect(splitKeys("a\x1b\rb")).toEqual(["a", Key.altEnter, "b"]);
  });
});
