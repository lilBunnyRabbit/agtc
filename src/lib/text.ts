const ELLIPSIS = "…";

export function collapse(text: string, maxLength = 400): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > maxLength ? flat.slice(0, maxLength - 1) + ELLIPSIS : flat;
}

export function truncate(text: string, width: number): string {
  if (width <= 0) return "";
  if (text.length <= width) return text;
  return width > 1 ? text.slice(0, width - 1) + ELLIPSIS : text.slice(0, width);
}

export function padRight(text: string, width: number): string {
  return truncate(text, width).padEnd(width);
}

export function wrapWords(text: string, width: number, maxLines: number): string[] {
  const lines: string[] = [];
  let current = "";
  for (const word of text.split(" ")) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= width) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    current = word;
    if (lines.length === maxLines) break;
  }
  if (current && lines.length < maxLines) lines.push(current);
  const wasCut = lines.join(" ").length < text.length;
  if (wasCut && lines.length === maxLines) lines[maxLines - 1] += ELLIPSIS;
  return lines.map((line) => truncate(line, width));
}

export function tildify(path: string, home: string): string {
  return path.startsWith(home) ? `~${path.slice(home.length)}` : path;
}

export function untildify(path: string, home: string): string {
  return path === "~" || path.startsWith("~/") ? home + path.slice(1) : path;
}

export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
