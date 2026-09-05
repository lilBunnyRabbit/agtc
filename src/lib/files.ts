import { closeSync, openSync, readFileSync, readSync, statSync } from "node:fs";

const DEFAULT_TAIL_BYTES = 64 * 1024;

/** The last complete lines of a file, reading at most `maxBytes` from its end. */
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

/** Every parseable line of a JSONL file. Malformed lines are skipped. */
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
