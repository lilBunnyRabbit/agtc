import type { Options } from "../../cli";
import { notify } from "../../desktop/notify";
import { copyToClipboard } from "../../lib/shell";
import { plural } from "../../lib/text";
import { filterSessions } from "../../model/search";
import { type Session, type Status, resumeCommand } from "../../model/session";
import { asSeen, collectSessions } from "../../model/sessions";
import type { StateStore } from "../../model/state-store";
import { OWN_PANE } from "../../tmux/env";
import { setupTmux } from "../../tmux/setup";
import { ANSI } from "../ansi";
import { Key, type Mouse, parseMouse } from "../keys";
import { terminalSize } from "../layout";
import { type Frame, type UiState, initialUiState, renderFrame } from "../render";
import { openScreen } from "../terminal";
import { missingFromLastHub, newAgent, newWorktree, restoreLastHub, resumeInTmux } from "./agents";
import type { AppContext, Ask } from "./context";
import { editPrompt, searchKey } from "./input";
import { closeReviewer, reportFindings, startReviewer } from "./review";
import { focus, jumpBy, jumpTo, openEditor, reviewDiff, showHelp } from "./stage";

const MESSAGE_TTL_MS = 3000;
/** Nothing reports a double click natively. */
const DOUBLE_CLICK_MS = 300;
const NEW_AGENT_REFRESH_MS = 1500;

const wantsYou = (status: Status) => status === "done" || status === "needs input";

export class App implements AppContext {
  sessions: Session[] = [];
  readonly ui: UiState;
  private refreshing = false;
  /** False until the first poll: what is done or waiting at startup is old news, not an alert. */
  private polled = false;
  private messageTimer: ReturnType<typeof setTimeout> | undefined;
  private onPromptSubmit: ((value: string) => void) | undefined;
  private restoreOffered = false;
  private frame: Frame | undefined;
  private lastClick: { id: string; at: number } | undefined;
  private readonly out = process.stdout;

  constructor(
    readonly options: Options,
    readonly state: StateStore,
  ) {
    this.ui = initialUiState(options.showInactive, options.jump === "zed" ? "open in editor" : "focus");
  }

  start(): void {
    openScreen({ mouse: true, onKey: (key) => this.handleKey(key), onResize: () => this.draw() });
    if (OWN_PANE) void setupTmux(OWN_PANE);
    this.draw();
    void this.refresh();
    setInterval(() => void this.refresh(), this.options.intervalMs);
  }

  // ---------------------------------------------------------------- context

  get visible(): Session[] {
    return filterSessions(this.sessions, this.ui);
  }

  private get selected(): Session | undefined {
    return this.visible[this.ui.selected];
  }

  select(session: Session): void {
    this.ui.selected = this.visible.indexOf(session);
    this.draw();
  }

  private clampSelection(): void {
    const last = this.visible.length - 1;
    this.ui.selected = Math.max(0, Math.min(this.ui.selected, last));
  }

  draw(): void {
    this.frame = renderFrame(this.sessions, this.ui, terminalSize());
    this.out.write(ANSI.clearScreen + this.frame.lines.join("\n"));
  }

  say(message: string): void {
    this.ui.message = message;
    if (this.messageTimer) clearTimeout(this.messageTimer);
    this.messageTimer = setTimeout(() => {
      this.ui.message = "";
      this.draw();
    }, MESSAGE_TTL_MS);
    this.draw();
  }

  ask(prompt: Ask, submit: (value: string) => void): void {
    this.ui.prompt = { ...prompt, value: prompt.value ?? "" };
    this.onPromptSubmit = submit;
    this.draw();
  }

  refreshSoon(): void {
    setTimeout(() => void this.refresh(), NEW_AGENT_REFRESH_MS);
  }

  markSeen(session: Session): void {
    this.state.mark(session.id);
    this.sessions = this.sessions.map((s) => (s.id === session.id ? asSeen(s) : s));
  }

  async refresh(): Promise<void> {
    if (this.refreshing) return;
    this.refreshing = true;
    try {
      const firstRunEver = this.state.isFresh;
      const before = new Map(this.sessions.map((s) => [s.id, s.status]));

      let next = await collectSessions({ days: this.options.days, state: this.state });
      if (firstRunEver) {
        // Everything already finished counts as seen, so only new completions light up.
        for (const session of next) if (session.status === "done") this.state.mark(session.id);
        this.state.save();
        next = next.map(asSeen);
      }

      const selectedId = this.selected?.id;
      this.sessions = next;
      this.ui.refreshedAt = Date.now();
      const index = selectedId ? filterSessions(next, this.ui).findIndex((s) => s.id === selectedId) : -1;
      if (index >= 0) this.ui.selected = index;
      this.clampSelection();
      this.draw();
      this.offerRestore();

      if (this.polled) this.alert(this.sessions.filter((s) => wantsYou(s.status) && before.get(s.id) !== s.status));
      this.polled = true;
    } finally {
      this.refreshing = false;
    }
  }

  private alert(sessions: Session[]): void {
    if (!sessions.length) return;
    if (this.options.bell) this.out.write(ANSI.bell);
    if (!this.options.notify) return;
    for (const session of sessions) {
      if (session.viewed) continue;
      const subject = session.reviewOf ? this.sessions.find((s) => s.id === session.reviewOf) : undefined;
      const title = subject ? `review: ${subject.title}` : session.title;
      const subtitle = session.verdict ? `${session.verdict.ready ? "ready" : "not ready"} · ${session.verdict.text}` : session.status;
      void notify(title, subtitle);
    }
  }

  private offerRestore(): void {
    if (this.restoreOffered) return;
    this.restoreOffered = true;
    const missing = missingFromLastHub(this);
    if (missing.length) this.say(`${missing.length} ${plural(missing.length, "agent", "agents")} from the last hub not running. S restores them`);
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

  // ---------------------------------------------------------------- input

  private handleKey(key: string): void {
    const mouse = parseMouse(key);
    if (mouse) return this.handleMouse(mouse);
    if (key === Key.ctrlC) process.exit(0);
    if (this.ui.prompt) this.handlePromptKey(key);
    else if (this.ui.searchMode) {
      if (!searchKey(this, key)) return;
      this.clampSelection();
      this.draw();
    } else this.handleListKey(key);
  }

  /** A prompt keeps the mouse out. */
  private handleMouse({ button, x, y, release }: Mouse): void {
    if (this.ui.prompt || release) return;
    if (button === "wheelUp" || button === "wheelDown") {
      this.ui.selected += button === "wheelUp" ? -1 : 1;
      this.clampSelection();
      this.draw();
      return;
    }
    if (button !== "left") return;
    const session = this.frame?.hits[y - 1]?.find((hit) => x - 1 >= hit.from && x - 1 < hit.to)?.session;
    if (!session) return;
    const now = Date.now();
    const again = this.lastClick?.id === session.id && now - this.lastClick.at < DOUBLE_CLICK_MS;
    this.lastClick = again ? undefined : { id: session.id, at: now };
    this.select(session);
    if (again) focus(this, session);
  }

  private handlePromptKey(key: string): void {
    const prompt = this.ui.prompt!;
    const outcome = editPrompt(prompt, key);
    if (outcome === "ignored") return;
    if (outcome === "cancel") this.ui.prompt = undefined;
    if (outcome === "submit") {
      const submit = this.onPromptSubmit;
      this.ui.prompt = undefined;
      this.draw();
      submit?.(prompt.value);
      return;
    }
    this.draw();
  }

  private handleListKey(key: string): void {
    const session = this.selected;
    switch (key) {
      case "q":
        process.exit(0);
      case "/":
        this.ui.searchMode = true;
        break;
      case Key.escape:
        this.ui.query = "";
        this.ui.selected = 0;
        break;
      case "j":
      case Key.up:
        this.ui.selected--;
        break;
      case "k":
      case Key.down:
        this.ui.selected++;
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
      case "?":
        if (OWN_PANE) return showHelp(this);
        this.ui.showKeys = !this.ui.showKeys;
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
      case "o":
        if (session) openEditor(this, session);
        return;
      case "v":
        if (session) reviewDiff(this, session);
        return;
      case "V":
        if (session) session.reviewOf ? reportFindings(this, session) : startReviewer(this, session);
        return;
      case "x":
        if (session) closeReviewer(this, session);
        return;
      case "J":
        return jumpBy(this, -1);
      case "K":
        return jumpBy(this, 1);
      case "n":
        if (session) newAgent(this, session);
        return;
      case "N":
        if (session) newWorktree(this, session);
        return;
      case "R":
        if (session) resumeInTmux(this, session);
        return;
      case "S":
        return restoreLastHub(this);
      case Key.enter:
        if (session) focus(this, session);
        return;
      default:
        if (/^[1-9]$/.test(key)) jumpTo(this, Number(key));
        return;
    }
    this.clampSelection();
    this.draw();
  }
}
