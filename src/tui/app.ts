import type { Options } from "../cli";
import { copyToClipboard } from "../lib/shell";
import { filterSessions } from "../search";
import type { SeenStore } from "../seen-store";
import { type Session, resumeCommand } from "../session";
import { asSeen, collectSessions } from "../sessions";
import { focusTerminalTab } from "../sources/terminal";
import { ANSI } from "./ansi";
import { Key, isPrintable, splitKeys } from "./keys";
import { terminalSize } from "./layout";
import { type UiState, initialUiState, renderFrame } from "./render";

const MESSAGE_TTL_MS = 3000;

/** The interactive dashboard: polls sources, draws frames, reacts to keys. */
export class App {
  private sessions: Session[] = [];
  private readonly ui: UiState;
  private refreshing = false;
  private messageTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly out = process.stdout;

  constructor(
    private readonly options: Options,
    private readonly seen: SeenStore,
  ) {
    this.ui = initialUiState(options.showInactive);
  }

  start(): void {
    // stdin must be configured before the first stdout write: Bun otherwise
    // delays raw-mode reads and delivers several keys in one chunk.
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk: string) => {
      for (const key of splitKeys(chunk)) this.handleKey(key);
    });

    this.out.write(ANSI.altScreenOn + ANSI.hideCursor);
    process.on("exit", () => this.out.write(ANSI.showCursor + ANSI.altScreenOff));
    process.on("SIGINT", () => this.quit());
    process.on("SIGTERM", () => this.quit());
    this.out.on("resize", () => this.draw());

    this.draw();
    void this.refresh();
    setInterval(() => void this.refresh(), this.options.intervalMs);
  }

  // ---------------------------------------------------------------- state

  private get visible(): Session[] {
    return filterSessions(this.sessions, this.ui);
  }

  private get selected(): Session | undefined {
    return this.visible[this.ui.selected];
  }

  private clampSelection(): void {
    const last = this.visible.length - 1;
    this.ui.selected = Math.max(0, Math.min(this.ui.selected, last));
  }

  private draw(): void {
    const frame = renderFrame(this.sessions, this.ui, terminalSize());
    this.out.write(ANSI.clearScreen + frame.lines.join("\n"));
  }

  /** Shows a footer message that clears itself. */
  private say(message: string): void {
    this.ui.message = message;
    if (this.messageTimer) clearTimeout(this.messageTimer);
    this.messageTimer = setTimeout(() => {
      this.ui.message = "";
      this.draw();
    }, MESSAGE_TTL_MS);
    this.draw();
  }

  private async refresh(): Promise<void> {
    if (this.refreshing) return;
    this.refreshing = true;
    try {
      const firstRunEver = this.seen.isFresh;
      const previouslyDone = new Set(this.sessions.filter((s) => s.status === "done").map((s) => s.id));

      let next = await collectSessions({ days: this.options.days, seen: this.seen });
      if (firstRunEver) {
        // Treat everything already finished as seen, so only new completions light up.
        for (const session of next) if (session.status === "done") this.seen.mark(session.id);
        this.seen.save();
        next = next.map(asSeen);
      }

      this.sessions = next;
      this.ui.refreshedAt = Date.now();
      this.clampSelection();
      this.draw();

      const newlyDone = this.sessions.some((s) => s.status === "done" && !previouslyDone.has(s.id));
      if (this.options.bell && newlyDone) this.out.write(ANSI.bell);
    } finally {
      this.refreshing = false;
    }
  }

  // ---------------------------------------------------------------- actions

  private quit(): never {
    process.exit(0);
  }

  private markSeen(session: Session): void {
    this.seen.mark(session.id);
    this.sessions = this.sessions.map((s) => (s.id === session.id ? asSeen(s) : s));
  }

  private markAllSeen(): void {
    for (const session of this.sessions) if (session.status === "done") this.markSeen(session);
    this.say("all marked seen");
  }

  private copyResume(session: Session): void {
    const command = resumeCommand(session);
    copyToClipboard(command);
    this.say(`copied: ${command}`);
  }

  private focus(session: Session): void {
    const { tty } = session;
    if (!tty) {
      this.say(`not in a Terminal tab. resume: ${resumeCommand(session)}`);
      return;
    }
    this.markSeen(session);
    this.say(`focusing ${tty}…`);
    void focusTerminalTab(tty).then((found) => this.say(found ? `focused ${tty}` : `tab for ${tty} not found`));
  }

  // ---------------------------------------------------------------- keys

  private handleKey(key: string): void {
    if (this.ui.searchMode) this.handleSearchKey(key);
    else this.handleListKey(key);
  }

  private handleSearchKey(key: string): void {
    switch (key) {
      case Key.ctrlC:
        return this.quit();
      case Key.escape:
        this.ui.query = "";
        this.ui.searchMode = false;
        break;
      case Key.enter:
        this.ui.searchMode = false;
        break;
      case Key.backspace:
      case Key.backspaceAlt:
        this.ui.query = this.ui.query.slice(0, -1);
        break;
      case Key.ctrlU:
        this.ui.query = "";
        break;
      case Key.up:
        this.ui.selected--;
        break;
      case Key.down:
        this.ui.selected++;
        break;
      default:
        if (!isPrintable(key)) return;
        this.ui.query += key;
    }
    this.clampSelection();
    this.draw();
  }

  private handleListKey(key: string): void {
    const session = this.selected;
    switch (key) {
      case "q":
      case Key.ctrlC:
        return this.quit();
      case "/":
        this.ui.searchMode = true;
        break;
      case Key.escape:
        this.ui.query = "";
        this.ui.selected = 0;
        break;
      case "j":
      case Key.down:
        this.ui.selected++;
        break;
      case "k":
      case Key.up:
        this.ui.selected--;
        break;
      case "g":
        this.ui.selected = 0;
        break;
      case "G":
        this.ui.selected = Infinity;
        break;
      case "a":
        this.ui.showInactive = !this.ui.showInactive;
        this.ui.selected = 0;
        break;
      case "d":
        this.ui.showDetail = !this.ui.showDetail;
        break;
      case "m":
        if (session) this.markSeen(session);
        break;
      case "M":
        return this.markAllSeen();
      case "r":
        this.say("refreshing…");
        void this.refresh();
        return;
      case "c":
        if (session) this.copyResume(session);
        return;
      case Key.enter:
        if (session) this.focus(session);
        return;
      default:
        return;
    }
    this.clampSelection();
    this.draw();
  }
}
