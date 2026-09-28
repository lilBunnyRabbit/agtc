import { describe, expect, test } from "bun:test";
import { Key, isPrintable, paneKey, parseMouse, parsePaneKey, splitKeys } from "../src/tui/keys";

describe("splitKeys", () => {
  test("plain characters split one by one", () => {
    expect(splitKeys("jk")).toEqual(["j", "k"]);
  });

  test("CSI sequences stay whole", () => {
    expect(splitKeys(`${Key.up}q${Key.shiftTab}`)).toEqual([Key.up, "q", Key.shiftTab]);
  });

  test("SGR mouse reports stay whole", () => {
    expect(splitKeys("\x1b[<0;10;5Mq")).toEqual(["\x1b[<0;10;5M", "q"]);
  });

  test("legacy mouse reports swallow their three bytes", () => {
    const report = "\x1b[M !!";
    expect(splitKeys(`${report}q`)).toEqual([report, "q"]);
  });

  test("a bare escape is one key", () => {
    expect(splitKeys("\x1b")).toEqual(["\x1b"]);
  });
});

describe("parseMouse", () => {
  test("SGR press and release", () => {
    expect(parseMouse("\x1b[<0;10;5M")).toEqual({ button: "left", x: 10, y: 5, release: false });
    expect(parseMouse("\x1b[<0;10;5m")).toEqual({ button: "left", x: 10, y: 5, release: true });
  });

  test("SGR wheel", () => {
    expect(parseMouse("\x1b[<64;1;1M")?.button).toBe("wheelUp");
    expect(parseMouse("\x1b[<65;1;1M")?.button).toBe("wheelDown");
  });

  test("legacy report", () => {
    const mouse = parseMouse("\x1b[M !!");
    expect(mouse).toEqual({ button: "left", x: 1, y: 1, release: false });
  });

  test("a key is not a mouse event", () => {
    expect(parseMouse("q")).toBeUndefined();
    expect(parseMouse(Key.up)).toBeUndefined();
  });
});

describe("isPrintable", () => {
  test("single visible characters only", () => {
    expect(isPrintable("a")).toBe(true);
    expect(isPrintable(" ")).toBe(true);
    expect(isPrintable("\x03")).toBe(false);
    expect(isPrintable(Key.up)).toBe(false);
  });
});

describe("paneKey", () => {
  test("survives the trip through splitKeys", () => {
    const typed = paneKey({ paneId: "%12", key: "V" });
    expect(splitKeys(`${typed}q`)).toEqual([typed, "q"]);
    expect(parsePaneKey(typed)).toEqual({ paneId: "%12", key: "V" });
  });

  test("a key or a mouse report is not one", () => {
    expect(parsePaneKey("V")).toBeUndefined();
    expect(parsePaneKey("\x1b[<0;10;5M")).toBeUndefined();
  });
});
