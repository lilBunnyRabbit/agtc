import { ANSI } from "./ansi";
import { splitKeys } from "./keys";

export interface ScreenOptions {
  onKey(key: string): void;
  onResize(): void;
  mouse?: boolean;
}

export interface Screen {
  close(): void;
}

export function openScreen({ onKey, onResize, mouse = false }: ScreenOptions): Screen {
  const out = process.stdout;
  const onData = (chunk: string) => {
    for (const key of splitKeys(chunk)) onKey(key);
  };
  const enter = ANSI.altScreenOn + ANSI.hideCursor + (mouse ? ANSI.mouseOn : "");
  const leave = (mouse ? ANSI.mouseOff : "") + ANSI.showCursor + ANSI.altScreenOff;
  let open = true;
  const close = () => {
    if (!open) return;
    open = false;
    process.stdin.off("data", onData);
    out.off("resize", onResize);
    process.stdin.setRawMode(false);
    process.stdin.pause();
    out.write(leave);
  };

  // stdin must be configured before the first stdout write: Bun otherwise
  // delays raw-mode reads and delivers several keys in one chunk.
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", onData);
  out.write(enter);
  process.on("exit", () => {
    if (open) out.write(leave);
  });
  process.on("SIGINT", () => process.exit(0));
  process.on("SIGTERM", () => process.exit(0));
  out.on("resize", onResize);
  return { close };
}
