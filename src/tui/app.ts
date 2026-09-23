import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { basename, isAbsolute, join } from "node:path";
import type { Options } from "../cli";
import { openInEditor } from "../editor";
import { HUB_SESSION } from "../hub";
import { collapse, plural, tildify, untildify } from "../lib/text";
import { copyToClipboard, run, shellQuote } from "../lib/shell";
import { HOME } from "../paths";
import { filterSessions } from "../search";
import type { SeenStore } from "../seen-store";
import { reportMessage, reviewerReport } from "../report";
import { restoreHub } from "../restore";
import { resolveSpec, reviewerCommand, reviewerFor, specPath, specRequest, writeReviewPrompt } from "../review";
import { type Session, type Tool, isTool, resumeCommand, resumeInvocation, workDir } from "../session";
import { asSeen, collectSessions } from "../sessions";
import { baseBranch, checkoutName, createWorktree } from "../sources/git";
import { focusTerminalTab } from "../sources/terminal";
import { OWN_PANE, focusTmuxPane, killPane, newTmuxWindow, pasteIntoPane, setupTmux, tmuxHasSession, tmuxPopup } from "../sources/tmux";
import { ANSI } from "./ansi";
import { Key, isPrintable, splitKeys } from "./keys";
import { terminalSize } from "./layout";
import { type Prompt, type UiState, initialUiState, renderFrame } from "./render";

const MESSAGE_TTL_MS = 3000;
const DEFAULT_WORKTREES_DIR = join(".claude", "worktrees");
/** A freshly started agent registers itself within this long. */
const NEW_AGENT_REFRESH_MS = 1500;

interface Launch {
  tool: Tool;
  dir: string;
  tmuxSession: string | undefined;
  /** What to type into the new window's shell. Default: the bare tool. */
  command?: string;
  /** Window name. Default: the checkout's name. */
  name?: string;
  /** Appended to the "started" message. */
  note?: string;
}

/** The interactive dashboard: polls sources, draws frames, reacts to keys. */
export class App {
  private sessions: Session[] = [];
  private readonly ui: UiState;
  private refreshing = false;
  private messageTimer: ReturnType<typeof setTimeout> | undefined;
  private onPromptSubmit: ((value: string) => void) | undefined;
  private restoreOffered = false;
  private readonly out = process.stdout;

  constructor(
    private readonly options: Options,
    private readonly seen: SeenStore,
  ) {
    this.ui = initialUiState(options.showInactive, options.jump === "zed" ? "open in editor" : "focus");
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
    if (OWN_PANE) void setupTmux(OWN_PANE);

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

      const selectedId = this.selected?.id;
      this.sessions = next;
      this.ui.refreshedAt = Date.now();
      const index = selectedId ? filterSessions(next, this.ui).findIndex((s) => s.id === selectedId) : -1;
      if (index >= 0) this.ui.selected = index;
      this.clampSelection();
      this.draw();
      this.offerRestore();

      const newlyDone = this.sessions.some((s) => s.status === "done" && !previouslyDone.has(s.id));
      if (this.options.bell && newlyDone) this.out.write(ANSI.bell);
    } finally {
      this.refreshing = false;
    }
  }

  /** Once per run: the last hub had agents that are not running now, tmux is gone or fresh. */
  private offerRestore(): void {
    if (this.restoreOffered) return;
    this.restoreOffered = true;
    const missing = this.missingFromLastHub();
    if (missing.length) this.say(`${missing.length} ${plural(missing.length, "agent", "agents")} from the last hub not running. S restores them`);
  }

  private missingFromLastHub() {
    const running = new Set(this.sessions.filter((s) => s.status !== "inactive").map((s) => s.id));
    return this.seen.lastHub().filter((w) => !running.has(w.id));
  }

  /** `S`: every agent window of the last hub again, in the hub session. */
  private restoreLastHub(): void {
    const missing = this.missingFromLastHub();
    if (!missing.length) {
      this.say("nothing to restore: every agent of the last hub is running");
      return;
    }
    void this.hubTarget().then(async (target) => {
      if (!target) {
        this.say("S needs a tmux session: run `agtc tmux`");
        return;
      }
      this.say(`restoring ${missing.length} ${plural(missing.length, "agent", "agents")}…`);
      const { opened, skipped } = await restoreHub(this.seen.lastHub(), this.sessions, target.session);
      const gone = skipped.filter((w) => !existsSync(w.cwd)).length;
      this.say(`restored ${opened.length}${gone ? `, ${gone} skipped, directory gone` : ""}`);
      setTimeout(() => void this.refresh(), NEW_AGENT_REFRESH_MS);
    });
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
    if (this.options.jump === "zed") {
      this.markSeen(session);
      this.openEditor(session);
      return;
    }
    const { tty, tmux } = session;
    if (!tty) {
      this.say(`not in a terminal. resume: ${resumeCommand(session)}`);
      return;
    }
    this.markSeen(session);
    this.say(`focusing ${tty}…`);
    if (tmux) {
      void focusTmuxPane(tmux.paneId, this.options.stagePercent).then((ok) => {
        this.say(ok ? `focused ${tty}` : `tmux pane ${tmux.paneId} not found`);
        if (ok && tmux.clientTty) void focusTerminalTab(tmux.clientTty);
      });
      return;
    }
    void focusTerminalTab(tty).then((found) => this.say(found ? `focused ${tty}` : `tab for ${tty} not found`));
  }

  /** The session's checkout, or undefined with a message when it no longer exists on disk. */
  private existingWorkDir(session: Session): string | undefined {
    const dir = workDir(session);
    if (existsSync(dir)) return dir;
    this.say(`directory is gone: ${tildify(dir, HOME)}`);
    return undefined;
  }

  private openEditor(session: Session): void {
    const dir = this.existingWorkDir(session);
    if (!dir) return;
    this.seen.markOpened(dir, session.id);
    const command = openInEditor(session);
    this.say(command ? `opened: ${command}` : "editor not found. Set AGTC_EDITOR.");
  }

  /** `v`: lazygit (or plain `git diff`) over the session's checkout, in a tmux popup. */
  private review(session: Session): void {
    if (!OWN_PANE) {
      this.say("v needs agtc inside tmux: run `agtc tmux`");
      return;
    }
    const dir = this.existingWorkDir(session);
    if (!dir) return;
    const command = `command -v lazygit >/dev/null && exec lazygit || exec git diff HEAD`;
    this.say(`reviewing ${tildify(dir, HOME)}…`);
    void tmuxPopup(dir, command, basename(dir)).then((ok) => this.say(ok ? "" : "could not open popup"));
  }

  /**
   * `n`: another agent of the same kind, in a new tmux window. Asks where first, starting
   * from the session's checkout; tab walks every checkout in the list.
   */
  private newAgent(session: Session): void {
    void this.tmuxTarget(session).then((target) => {
      if (!target) {
        this.say("n needs a tmux session: run `agtc tmux`");
        return;
      }
      const choices = this.knownCheckouts(session).map((dir) => tildify(dir, HOME));
      this.ask({ label: `new ${session.tool} in`, value: choices[0], choices }, (value) => {
        const dir = untildify(value.trim(), HOME);
        if (!dir) return;
        if (!existsSync(dir)) {
          this.say(`no such directory: ${tildify(dir, HOME)}`);
          return;
        }
        void this.startAgent({ tool: session.tool, dir, tmuxSession: target.session });
      });
    });
  }

  /**
   * `V`: a second agent reads the session's work against its spec and reports, read-only. Its
   * process is fresh, so the author's reasoning never reaches it; the other tool by default,
   * so not even memory does.
   */
  private startReviewer(session: Session): void {
    const running = this.sessions.find((s) => s.reviewOf === session.id && s.status !== "inactive");
    if (running) {
      this.say(`${running.tool} is still reviewing this: quit it first`);
      return;
    }
    const dir = this.existingWorkDir(session);
    if (!dir) return;
    void this.tmuxTarget(session).then((target) => {
      if (!target) {
        this.say("V needs a tmux session: run `agtc tmux`");
        return;
      }
      const written = specPath(session.id);
      const askAuthor = `ask ${session.tool} for a spec`;
      const prompts = [session.firstPrompt, session.lastPrompt].filter((p): p is string => !!p && !p.startsWith("/"));
      const choices = [...new Set([...(existsSync(written) ? [tildify(written, HOME)] : []), askAuthor, ...prompts])];
      this.ask({ label: "spec (text, @file)", value: choices[0], choices }, (answer) => {
        if (answer.trim() === askAuthor) return this.requestSpec(session, written);
        const spec = resolveSpec(answer);
        if (!spec) return;
        const tools = [reviewerFor(session.tool), session.tool];
        this.ask({ label: "reviewer", value: tools[0], choices: tools }, (tool) => {
          if (!isTool(tool)) {
            this.say(`unknown tool: ${tool}`);
            return;
          }
          void this.launchReviewer(session, dir, spec, tool, target.session);
        });
      });
    });
  }

  /** The author knows what was built: the request for a spec lands in its input, you send it, `V` again once the file exists. */
  private requestSpec(session: Session, path: string): void {
    void this.handTo(session, specRequest(path)).then((where) => {
      if (where === "pane") this.say(`spec request in "${collapse(session.title, 40)}": enter there, then V again`);
      else if (where === "clipboard") this.say(session.status === "inactive" ? "spec request copied: R resumes the session, paste it there" : "spec request copied: the session runs outside tmux, paste it there");
    });
  }

  /** `x`: a reviewer is disposable once its report is over, so this ends it, window and all. Only reviewers: nothing else agtc started is read-only. */
  private closeReviewer(session: Session): void {
    if (!session.reviewOf) {
      this.say("x closes reviewers only: quit other agents in their own window");
      return;
    }
    if (session.status === "inactive") {
      this.say("not running");
      return;
    }
    if (!session.tmux) {
      this.say(`runs outside tmux in ${session.tty ?? "another terminal"}: quit it there`);
      return;
    }
    if (session.status === "done") {
      this.say("unread report: V hands it over, m drops it, then x");
      return;
    }
    const { paneId } = session.tmux;
    void killPane(paneId).then((ok) => {
      this.say(ok ? `closed ${session.tool} reviewer` : `tmux pane ${paneId} not found`);
      if (ok) setTimeout(() => void this.refresh(), NEW_AGENT_REFRESH_MS);
    });
  }

  /** Puts text into a session's input, unsent, and shows the session. One the paste cannot reach gets it on the clipboard. */
  private async handTo(session: Session, text: string): Promise<"pane" | "clipboard" | undefined> {
    if (session.status === "inactive" || !session.tmux) {
      copyToClipboard(text);
      return "clipboard";
    }
    const { paneId } = session.tmux;
    if (!(await pasteIntoPane(paneId, text))) {
      this.say(`could not paste into tmux pane ${paneId}`);
      return undefined;
    }
    await this.showPane(paneId);
    return "pane";
  }

  private async launchReviewer(session: Session, dir: string, spec: string, tool: Tool, tmuxSession: string | undefined): Promise<void> {
    const id = randomUUID();
    const base = session.changes?.base ?? (await baseBranch(dir));
    const promptPath = writeReviewPrompt(id, { spec, base });
    const paneId = await this.startAgent({
      tool,
      dir,
      tmuxSession,
      command: reviewerCommand(tool, id, promptPath),
      name: `${await checkoutName(dir)} review`,
      note: ` to review "${collapse(session.title, 40)}"`,
    });
    if (!paneId) return;
    this.seen.rememberReview({ id: tool === "claude" ? id : undefined, pane: paneId, of: session.id, at: Date.now() });
  }

  /**
   * `V` on a reviewer: its last message goes into the reviewed session's input, unsent, for
   * you to read and pass on. A session the paste cannot reach gets it on the clipboard.
   */
  private reportFindings(reviewer: Session): void {
    const subject = this.sessions.find((s) => s.id === reviewer.reviewOf);
    if (!subject) {
      this.say("the reviewed session is not in the list");
      return;
    }
    if (reviewer.status === "busy") {
      this.say("reviewer still working");
      return;
    }
    if (reviewer.status === "needs input") {
      this.say("reviewer is waiting on you: enter to answer it");
      return;
    }
    const report = reviewerReport(reviewer);
    if (!report) {
      this.say("no report yet: the reviewer has not finished a turn");
      return;
    }
    this.markSeen(reviewer);
    void this.handTo(subject, reportMessage(reviewer, report)).then((where) => {
      if (where === "pane") this.say(`report pasted into "${collapse(subject.title, 40)}": read it, then enter`);
      else if (where === "clipboard") this.say(subject.status === "inactive" ? "report copied: R resumes the session, then paste" : `report copied: "${collapse(subject.title, 40)}" runs outside tmux, paste it there`);
    });
  }

  /** Every checkout the list knows: the session's own, the rest of its repository, then the other repositories. */
  private knownCheckouts(session: Session): string[] {
    const dirs = new Set([workDir(session)]);
    const sameRepoFirst = [...this.sessions].sort((a, b) => Number(b.repo === session.repo) - Number(a.repo === session.repo));
    for (const s of sameRepoFirst) {
      if (s.mainRoot) dirs.add(s.mainRoot);
      dirs.add(workDir(s));
    }
    return [...dirs].filter((dir) => existsSync(dir));
  }

  /** Opens a tmux window in `dir` running `command` (the bare tool by default) and shows it. Returns the pane id. */
  private async startAgent({ tool, dir, tmuxSession, command = tool, name, note = "" }: Launch): Promise<string | undefined> {
    const paneId = await newTmuxWindow(dir, command, tmuxSession, name ?? (await checkoutName(dir)));
    if (!paneId) {
      this.say(`could not open tmux window in ${tildify(dir, HOME)}`);
      return undefined;
    }
    this.say(`started ${tool} in ${tildify(dir, HOME)}${note}`);
    await this.showPane(paneId);
    setTimeout(() => void this.refresh(), NEW_AGENT_REFRESH_MS);
    return paneId;
  }

  /**
   * `N`: a fresh worktree of the session's repository, then an agent in it. Lives outside
   * Zed's worktree directory, so Zed never archives it. Branch = name; a directory name
   * swaps "/" for "+", like Claude Code does.
   */
  private newWorktree(session: Session): void {
    const { mainRoot } = session;
    if (!mainRoot) {
      this.say("not a git checkout");
      return;
    }
    void this.tmuxTarget(session).then((target) => {
      if (!target) {
        this.say("N needs a tmux session: run `agtc tmux`");
        return;
      }
      this.ask({ label: "new worktree branch" }, (name) => {
        const branch = name.trim();
        if (!branch) return;
        const dir = join(this.worktreesDir(mainRoot), branch.replace(/\//g, "+"));
        if (existsSync(dir)) {
          this.say(`already exists: ${tildify(dir, HOME)}`);
          return;
        }
        void this.createAndStart(session, mainRoot, dir, branch, target.session);
      });
    });
  }

  private async createAndStart(session: Session, mainRoot: string, dir: string, branch: string, tmuxSession: string | undefined): Promise<void> {
    const base = this.options.base ?? (await baseBranch(mainRoot)) ?? "HEAD";
    this.say(`creating ${tildify(dir, HOME)} from ${base}…`);
    const error = await createWorktree(mainRoot, { dir, branch, base });
    if (error) {
      this.say(`git: ${collapse(error, 160)}`);
      return;
    }
    await this.startAgent({ tool: session.tool, dir, tmuxSession, note: ` (${branch} from ${base})` });
  }

  /**
   * `P`: the moment work leaves the machine, so it is a key and it checks first. Pushes the
   * checkout's branch and opens its pull request in the browser, existing or new, in a popup
   * that waits for enter so a refusal from git or gh can be read.
   */
  private pushAndOpenPr(session: Session): void {
    if (!OWN_PANE) {
      this.say("P needs agtc inside tmux: run `agtc tmux`");
      return;
    }
    if (!session.root) {
      this.say("not a git checkout");
      return;
    }
    const dir = this.existingWorkDir(session);
    if (!dir) return;
    void this.pushGate(session, dir).then((gate) => {
      if (!gate.ok) {
        this.say(gate.why);
        return;
      }
      const command = [
        `git push -u origin ${shellQuote(gate.branch)}`,
        "&& { command -v gh >/dev/null || { echo 'gh not installed: open the pull request by hand'; false; }; }",
        "&& { gh pr view --web 2>/dev/null || gh pr create --web; }",
        "; echo; echo 'enter closes'; read -r _",
      ].join(" ");
      this.say(`pushing ${gate.branch}…`);
      void tmuxPopup(dir, command, `push ${gate.branch}`).then((ok) => this.say(ok ? "" : "could not open popup"));
    });
  }

  /** Whether the push may go. Asks git fresh: the polled state may predate the commit you just made. */
  private async pushGate(session: Session, dir: string): Promise<{ ok: true; branch: string } | { ok: false; why: string }> {
    const branch = await run(["git", "-C", dir, "rev-parse", "--abbrev-ref", "HEAD"]);
    if (!branch || branch === "HEAD") return { ok: false, why: "detached HEAD: check out a branch first" };
    const base = session.changes?.base ?? (await baseBranch(dir));
    if (base && branch === base.replace(/^[^/]+\//, "")) return { ok: false, why: `on ${branch} itself: P pushes feature branches only` };
    if (await run(["git", "-C", dir, "status", "--porcelain"])) return { ok: false, why: "uncommitted changes: commit first (v)" };
    const reviewing = this.sessions.find((s) => s.reviewOf && s.status === "busy" && workDir(s) === dir);
    if (reviewing) return { ok: false, why: `${reviewing.tool} is still reviewing: wait for its report` };
    return { ok: true, branch };
  }

  /** In zed mode panes stay in their own windows, so a Zed terminal attached to one keeps it. */
  private async showPane(paneId: string): Promise<void> {
    if (this.options.jump === "tmux") await focusTmuxPane(paneId, this.options.stagePercent);
  }

  private worktreesDir(mainRoot: string): string {
    const configured = this.options.worktrees ?? DEFAULT_WORKTREES_DIR;
    return isAbsolute(configured) ? configured : join(mainRoot, configured);
  }

  /**
   * `R`: picks a finished session up again inside tmux, where attach and send can reach it.
   * A session still running in a Terminal.app tab has to be quit there first: two processes
   * on one session id would write the same transcript.
   */
  private resumeInTmux(session: Session): void {
    if (session.tmux) {
      this.say("already in tmux");
      return;
    }
    if (session.status !== "inactive") {
      this.say(`still running in ${session.tty ?? "another terminal"}: quit it there, then R`);
      return;
    }
    if (!existsSync(session.cwd)) {
      this.say(`directory is gone: ${tildify(session.cwd, HOME)}`);
      return;
    }
    void this.tmuxTarget(session).then(async (target) => {
      if (!target) {
        this.say("R needs a tmux session: run `agtc tmux`");
        return;
      }
      const paneId = await newTmuxWindow(session.cwd, resumeInvocation(session), target.session, await checkoutName(session.cwd));
      if (!paneId) {
        this.say("could not open tmux window");
        return;
      }
      this.say(`resumed ${session.tool} in ${tildify(session.cwd, HOME)}`);
      await this.showPane(paneId);
      setTimeout(() => void this.refresh(), NEW_AGENT_REFRESH_MS);
    });
  }

  /** Session a new window goes to: agtc's own (tmux picks it when unnamed), else the agent's, else the hub. */
  private async tmuxTarget(session: Session): Promise<{ session?: string } | undefined> {
    if (session.tmux && !OWN_PANE) return { session: session.tmux.session };
    return this.hubTarget();
  }

  /** agtc's own session when inside tmux, else the hub session when it exists. */
  private async hubTarget(): Promise<{ session?: string } | undefined> {
    if (OWN_PANE) return {};
    return (await tmuxHasSession(HUB_SESSION)) ? { session: HUB_SESSION } : undefined;
  }

  // ---------------------------------------------------------------- keys

  private handleKey(key: string): void {
    if (this.ui.prompt) this.handlePromptKey(key);
    else if (this.ui.searchMode) this.handleSearchKey(key);
    else this.handleListKey(key);
  }

  private ask(prompt: Omit<Prompt, "value"> & { value?: string }, submit: (value: string) => void): void {
    this.ui.prompt = { ...prompt, value: prompt.value ?? "" };
    this.onPromptSubmit = submit;
    this.draw();
  }

  private handlePromptKey(key: string): void {
    const prompt = this.ui.prompt!;
    switch (key) {
      case Key.ctrlC:
        return this.quit();
      case Key.escape:
        this.ui.prompt = undefined;
        break;
      case Key.enter: {
        const submit = this.onPromptSubmit;
        this.ui.prompt = undefined;
        this.draw();
        submit?.(prompt.value);
        return;
      }
      case Key.backspace:
      case Key.backspaceAlt:
        prompt.value = prompt.value.slice(0, -1);
        break;
      case Key.ctrlU:
        prompt.value = "";
        break;
      case Key.tab:
      case Key.shiftTab:
        cycleChoice(prompt, key === Key.tab ? 1 : -1);
        break;
      default:
        if (!isPrintable(key)) return;
        prompt.value += key;
    }
    this.draw();
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
      case "?":
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
        if (session) this.openEditor(session);
        return;
      case "v":
        if (session) this.review(session);
        return;
      case "V":
        if (session) session.reviewOf ? this.reportFindings(session) : this.startReviewer(session);
        return;
      case "P":
        if (session) this.pushAndOpenPr(session);
        return;
      case "x":
        if (session) this.closeReviewer(session);
        return;
      case "n":
        if (session) this.newAgent(session);
        return;
      case "N":
        if (session) this.newWorktree(session);
        return;
      case "R":
        if (session) this.resumeInTmux(session);
        return;
      case "S":
        this.restoreLastHub();
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

/** Tab walks the prompt's choices; a value typed by hand starts over from the first (or last). */
function cycleChoice(prompt: Prompt, step: number): void {
  const { choices, value } = prompt;
  if (!choices?.length) return;
  const at = choices.indexOf(value);
  prompt.value = at < 0 && step < 0 ? choices[choices.length - 1] : choices[(at + step + choices.length) % choices.length];
}
