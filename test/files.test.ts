import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseJsonLine, readJson, readJsonLines, readLinesFrom, readTailLines } from "../src/lib/files";
import { TtlCache } from "../src/lib/ttl-cache";

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "agtc-files-"));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("files", () => {
  test("readTailLines drops a partial first line when the tail starts mid-line", () => {
    const path = join(dir, "tail.txt");
    writeFileSync(path, "line one\nline two\nline three\n");
    expect(readTailLines(path)).toEqual(["line one", "line two", "line three"]);
    expect(readTailLines(path, 12)).toEqual(["line three"]);
    expect(readTailLines(join(dir, "missing"))).toEqual([]);
  });

  test("readLinesFrom reads only complete lines and resumes", () => {
    const path = join(dir, "grow.txt");
    writeFileSync(path, "a\nb\npartial");
    const first = readLinesFrom(path, 0);
    expect(first.lines).toEqual(["a", "b"]);
    expect(first.next).toBe(4);
    writeFileSync(path, "a\nb\npartial\nc\n");
    const second = readLinesFrom(path, first.next);
    expect(second.lines).toEqual(["partial", "c"]);
    writeFileSync(path, "x\n");
    expect(readLinesFrom(path, second.next).lines).toEqual(["x"]);
    expect(readLinesFrom(join(dir, "missing"), 7)).toEqual({ lines: [], next: 7 });
  });

  test("json helpers swallow errors", () => {
    const path = join(dir, "data.json");
    writeFileSync(path, '{"a":1}');
    expect(readJson<{ a: number }>(path)).toEqual({ a: 1 });
    expect(readJson(join(dir, "missing.json"))).toBeUndefined();
    expect(parseJsonLine<{ b: number }>('{"b":2}')).toEqual({ b: 2 });
    expect(parseJsonLine("nope")).toBeUndefined();
    expect(parseJsonLine("")).toBeUndefined();

    const lines = join(dir, "data.jsonl");
    writeFileSync(lines, '{"a":1}\nbroken\n{"a":2}\n');
    expect(readJsonLines<{ a: number }>(lines)).toEqual([{ a: 1 }, { a: 2 }]);
  });
});

describe("TtlCache", () => {
  test("shares in-flight loads and expires", async () => {
    const cache = new TtlCache<string, number>(50);
    let loads = 0;
    const load = async () => ++loads;
    const [a, b] = await Promise.all([cache.get("k", load), cache.get("k", load)]);
    expect(a).toBe(1);
    expect(b).toBe(1);
    expect(await cache.get("k", load)).toBe(1);
    await Bun.sleep(60);
    expect(await cache.get("k", load)).toBe(2);
  });
});
