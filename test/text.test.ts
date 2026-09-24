import { describe, expect, test } from "bun:test";
import { collapse, padRight, plural, tildify, truncate, untildify, wrapWords } from "../src/lib/text";
import { DAY, HOUR, MINUTE, SECOND, parseElapsed, relativeAge } from "../src/lib/time";

describe("text", () => {
  test("collapse flattens whitespace and caps length", () => {
    expect(collapse("  a \n\t b  ")).toBe("a b");
    expect(collapse("abcdef", 4)).toBe("abc…");
  });

  test("truncate", () => {
    expect(truncate("hello", 10)).toBe("hello");
    expect(truncate("hello", 3)).toBe("he…");
    expect(truncate("hello", 1)).toBe("h");
    expect(truncate("hello", 0)).toBe("");
  });

  test("padRight is exactly width", () => {
    expect(padRight("ab", 4)).toBe("ab  ");
    expect(padRight("abcdef", 4)).toBe("abc…");
  });

  test("wrapWords", () => {
    expect(wrapWords("one two three four", 9, 3)).toEqual(["one two", "three", "four"]);
    expect(wrapWords("one two three four", 9, 2)).toEqual(["one two", "three…"]);
    expect(wrapWords("", 9, 2)).toEqual([]);
  });

  test("tildify and untildify", () => {
    expect(tildify("/home/u/x", "/home/u")).toBe("~/x");
    expect(tildify("/other", "/home/u")).toBe("/other");
    expect(untildify("~/x", "/home/u")).toBe("/home/u/x");
    expect(untildify("~", "/home/u")).toBe("/home/u");
    expect(untildify("~x", "/home/u")).toBe("~x");
  });

  test("plural", () => {
    expect(plural(1, "file", "files")).toBe("1 file");
    expect(plural(2, "file", "files")).toBe("2 files");
  });
});

describe("time", () => {
  test("relativeAge buckets", () => {
    const now = 10 * DAY;
    expect(relativeAge(now - 5 * SECOND, now)).toBe("5s");
    expect(relativeAge(now - 3 * MINUTE, now)).toBe("3m");
    expect(relativeAge(now - 2 * HOUR, now)).toBe("2h");
    expect(relativeAge(now - 2 * DAY, now)).toBe("2d");
    expect(relativeAge(now + SECOND, now)).toBe("0s");
  });

  test("parseElapsed handles every ps shape", () => {
    expect(parseElapsed("05")).toBe(5 * SECOND);
    expect(parseElapsed("01:05")).toBe(MINUTE + 5 * SECOND);
    expect(parseElapsed("02:01:05")).toBe(2 * HOUR + MINUTE + 5 * SECOND);
    expect(parseElapsed("1-02:01:05")).toBe(DAY + 2 * HOUR + MINUTE + 5 * SECOND);
  });
});
