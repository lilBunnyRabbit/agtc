import { closeSync, fstatSync, openSync, readFileSync, readSync, statSync } from "node:fs";

const DEFAULT_TAIL_BYTES = 64 * 1024;

export function readTailLines(path: string, maxBytes = DEFAULT_TAIL_BYTES): string[] {
  try {
    const size = statSync(path).size;
    const length = Math.min(size, maxBytes);
    const buffer = Buffer.alloc(length);
    const fd = openSync(path, "r");
    try {
      readSync(fd, buffer, 0, length, size - length);
    } finally {
      closeSync(fd);
    }
    const lines = buffer.toString("utf8").split("\n");
    const startsMidLine = length < size;
    if (startsMidLine) lines.shift();
    return lines.filter(Boolean);
  } catch {
    return [];
  }
}

export interface LinesFrom {
  lines: string[];
  next: number;
}

/**
 * Complete lines of a growing file from byte `offset` on. A partial last line stays unread
 * until it is finished. A file shorter than `offset` was rewritten: reading restarts at 0.
 */
export function readLinesFrom(path: string, offset: number): LinesFrom {
  let fd: number;
  try {
    fd = openSync(path, "r");
  } catch {
    return { lines: [], next: offset };
  }
  try {
    const size = fstatSync(fd).size;
    const start = size < offset ? 0 : offset;
    const buffer = Buffer.alloc(size - start);
    readSync(fd, buffer, 0, buffer.length, start);
    const text = buffer.toString("utf8");
    const end = text.lastIndexOf("\n");
    if (end < 0) return { lines: [], next: start };
    const complete = text.slice(0, end + 1);
    return { lines: complete.split("\n").filter(Boolean), next: start + Buffer.byteLength(complete) };
  } catch {
    return { lines: [], next: offset };
  } finally {
    closeSync(fd);
  }
}

export function readJson<T>(path: string): T | undefined {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return undefined;
  }
}

export function parseJsonLine<T>(line: string): T | undefined {
  if (!line) return undefined;
  try {
    return JSON.parse(line) as T;
  } catch {
    return undefined;
  }
}

export function readJsonLines<T>(path: string): T[] {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return [];
  }
  const items: T[] = [];
  for (const line of text.split("\n")) {
    const item = parseJsonLine<T>(line);
    if (item !== undefined) items.push(item);
  }
  return items;
}
