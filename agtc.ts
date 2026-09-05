#!/usr/bin/env bun
// agtc — Agent Traffic Control. Terminal dashboard for local Claude Code + Codex sessions.
//
//   agtc                       interactive TUI
//   agtc --once                print one frame and exit
//   agtc --json                dump rows as JSON
//   --days N (default 2)       how far back to list inactive sessions
//   --interval MS              poll interval (default 2000)
//   --inactive                 start with inactive rows shown
//   --bell                     ring the terminal bell when a session finishes unseen
//
// States:
//   needs input  session is blocked on a dialog / permission
//   done         turn finished after your last prompt and you have not looked at it yet
//   busy         working
//   idle         waiting for you, output already seen
//   inactive     not running (recent history)
//
// "Seen" = Terminal.app is frontmost with that session's tab selected at any poll
// after the turn finished, or you focused it from here (enter), or pressed m / M.
// Seen marks persist in ~/.cache/agtc/state.json.
//
// Sources:
//   Claude live      ~/.claude/sessions/<pid>.json   (status, waitingFor, cwd)
//   Claude prompts   ~/.claude/history.jsonl         (every prompt per session)
//   Codex live       ps + lsof (cwd + open thread-writer-locks/<id>.lock)
//   Codex status     tail of the thread's rollout .jsonl (task_started / task_complete)
//   Worktree         git rev-parse --git-dir vs --git-common-dir
//   Tab title/focus  Terminal.app AppleScript keyed by tty

import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { Database } from "bun:sqlite";

type Status = "needs input" | "done" | "busy" | "idle" | "inactive";
type Tool = "claude" | "codex";

interface Row {
  tool: Tool;
  id: string;
  pid?: number;
  status: Status;
  waitingFor?: string;
  cwd: string;
  repo: string;
  worktree?: string;
  branch?: string;
  title: string;
  first?: string;
  lastPrompt?: string;
  lastPromptAt?: number;
  completedAt?: number;
  prompts: string[];
  since: number;
  tty?: string;
  search: string;
}

interface GitInfo {
  repo: string;
  worktree?: string;
  branch?: string;
}

interface TabInfo {
  title: string;
  viewed: boolean; // Terminal frontmost, window frontmost, tab selected
}

const HOME = homedir();
const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const opt = (name: string, fallback: string) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const DAYS = Number(opt("--days", "2"));
const POLL_MS = Number(opt("--interval", "2000"));
const BELL = flag("--bell");
const cutoff = () => Date.now() - DAYS * 86_400_000;

// ---------------------------------------------------------------- helpers

async function sh(argv: string[]): Promise<string> {
  try {
    const p = Bun.spawn(argv, { stdin: "ignore", stdout: "pipe", stderr: "ignore" });
    const out = await new Response(p.stdout).text();
    await p.exited;
    return out.trim();
  } catch {
    return "";
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e: any) {
    return e?.code === "EPERM";
  }
}

function tailLines(path: string, bytes = 64 * 1024): string[] {
  try {
    const size = statSync(path).size;
    const len = Math.min(size, bytes);
    const buf = Buffer.alloc(len);
    const fd = openSync(path, "r");
    readSync(fd, buf, 0, len, size - len);
    closeSync(fd);
    const lines = buf.toString("utf8").split("\n");
    if (len < size) lines.shift();
    return lines.filter(Boolean);
  } catch {
    return [];
  }
}

function collapse(s: string, max = 400): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max - 1) + "…" : t;
}

function age(ms: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

const tilde = (p: string) => (p.startsWith(HOME) ? "~" + p.slice(HOME.length) : p);

function finish(r: Omit<Row, "search">): Row {
  const search = [r.title, r.first, r.lastPrompt, ...r.prompts, r.worktree, r.branch, r.cwd, r.repo, r.tool, r.status, r.waitingFor, r.id, r.pid]
    .filter((x) => x !== undefined && x !== "")
    .join("\n")
    .toLowerCase();
  return { ...r, search };
}

// ---------------------------------------------------------------- persisted seen-marks

interface State {
  seen: Record<string, number>; // session id -> seenAt
}

const STATE_DIR = join(HOME, ".cache", "agtc");
const STATE_PATH = join(STATE_DIR, "state.json");
let state: State = { seen: {} };
let stateIsNew = true;

function loadState() {
  try {
    state = JSON.parse(readFileSync(STATE_PATH, "utf8"));
    if (!state.seen) state.seen = {};
    stateIsNew = false;
  } catch {
    state = { seen: {} };
    stateIsNew = true;
  }
}

function saveState() {
  try {
    mkdirSync(STATE_DIR, { recursive: true });
    writeFileSync(STATE_PATH, JSON.stringify(state));
  } catch {}
}

function markSeen(id: string, at = Date.now()) {
  if ((state.seen[id] ?? 0) >= at) return;
  state.seen[id] = at;
  saveState();
}

// ---------------------------------------------------------------- git

const gitCache = new Map<string, { at: number; info: GitInfo }>();
const gitInflight = new Map<string, Promise<GitInfo>>();

function gitInfo(cwd: string): Promise<GitInfo> {
  const hit = gitCache.get(cwd);
  if (hit && Date.now() - hit.at < 30_000) return Promise.resolve(hit.info);
  const pending = gitInflight.get(cwd);
  if (pending) return pending;
  const p = (async () => {
    const out = await sh(["git", "-C", cwd, "rev-parse", "--show-toplevel", "--git-dir", "--git-common-dir", "--abbrev-ref", "HEAD"]);
    let info: GitInfo;
    if (!out) {
      info = { repo: basename(cwd) };
    } else {
      const [top, gitDir, common, branch] = out.split("\n");
      const abs = (x: string) => (x.startsWith("/") ? x : join(top, x));
      const isWorktree = abs(gitDir) !== abs(common);
      info = {
        repo: basename(isWorktree ? dirname(abs(common)) : top),
        worktree: isWorktree ? basename(top) : undefined,
        branch,
      };
    }
    gitCache.set(cwd, { at: Date.now(), info });
    gitInflight.delete(cwd);
    return info;
  })();
  gitInflight.set(cwd, p);
  return p;
}

// ---------------------------------------------------------------- processes / Terminal.app

interface ProcInfo {
  tty?: string;
  startedAt: number;
}

// ps etime is [[dd-]hh:]mm:ss on macOS
function parseEtime(s: string): number {
  const [dayPart, rest] = s.includes("-") ? s.split("-") : ["0", s];
  const parts = rest.split(":").map(Number);
  while (parts.length < 3) parts.unshift(0);
  const [h, m, sec] = parts;
  return Number(dayPart) * 86400 + h * 3600 + m * 60 + sec;
}

async function procInfo(pids: number[]): Promise<Map<number, ProcInfo>> {
  const map = new Map<number, ProcInfo>();
  if (!pids.length) return map;
  for (const line of (await sh(["ps", "-o", "pid=,tty=,etime=", "-p", pids.join(",")])).split("\n")) {
    const m = line.trim().match(/^(\d+)\s+(\S+)\s+(\S+)/);
    if (!m) continue;
    map.set(Number(m[1]), { tty: m[2] === "??" ? undefined : m[2], startedAt: Date.now() - parseEtime(m[3]) * 1000 });
  }
  return map;
}

let terminalCheck: { at: number; running: boolean } | undefined;

async function terminalRunning(): Promise<boolean> {
  if (terminalCheck && Date.now() - terminalCheck.at < 30_000) return terminalCheck.running;
  const running = (await sh(["ps", "-eo", "comm="])).split("\n").some((c) => c.endsWith("/MacOS/Terminal"));
  terminalCheck = { at: Date.now(), running };
  return running;
}

async function terminalTabs(): Promise<Map<string, TabInfo>> {
  const map = new Map<string, TabInfo>();
  if (!(await terminalRunning())) return map;
  const script = `
tell application "Terminal"
  set out to "FRONT" & (ASCII character 9) & (frontmost as text) & linefeed
  repeat with w in windows
    set wf to frontmost of w
    repeat with t in tabs of w
      set out to out & (tty of t) & (ASCII character 9) & (wf as text) & (ASCII character 9) & ((selected of t) as text) & (ASCII character 9) & (custom title of t) & linefeed
    end repeat
  end repeat
  return out
end tell`;
  let appFront = false;
  for (const line of (await sh(["osascript", "-e", script])).split("\n")) {
    const parts = line.split("\t");
    if (parts[0] === "FRONT") {
      appFront = parts[1] === "true";
      continue;
    }
    const [tty, winFront, selected, title] = parts;
    if (tty) map.set(tty.replace("/dev/", ""), { title: title ?? "", viewed: appFront && winFront === "true" && selected === "true" });
  }
  return map;
}

async function focusTab(tty: string): Promise<boolean> {
  if (!(await terminalRunning())) return false;
  const script = `
tell application "Terminal"
  repeat with w in windows
    repeat with t in tabs of w
      if tty of t is "/dev/${tty}" then
        set selected of t to true
        set frontmost of w to true
        activate
        return "ok"
      end if
    end repeat
  end repeat
  return ""
end tell`;
  return (await sh(["osascript", "-e", script])) === "ok";
}

const SPINNER = /^[◐◑◒◓◴◵◶◷⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/;
const stripGlyph = (t: string) => t.replace(/^[^\p{L}\p{N}]+\s*/u, "").trim();

// ---------------------------------------------------------------- Claude

interface HistEntry {
  project: string;
  first: string;
  lastPrompt: string;
  prompts: string[];
  last: number;
}

let histCache: { key: string; map: Map<string, HistEntry> } | undefined;
const goodTitle = (t: string) => !t.startsWith("/") && t.trim().length >= 10;

function claudeHistory(): Map<string, HistEntry> {
  const p = join(HOME, ".claude", "history.jsonl");
  if (!existsSync(p)) return new Map();
  const st = statSync(p);
  const key = `${st.size}:${st.mtimeMs}`;
  if (histCache && histCache.key === key) return histCache.map;
  const map = new Map<string, HistEntry>();
  for (const line of readFileSync(p, "utf8").split("\n")) {
    if (!line) continue;
    let e: any;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    if (!e.sessionId || !e.timestamp) continue;
    const text = collapse(String(e.display ?? ""), 1000);
    const h = map.get(e.sessionId);
    if (!h) {
      map.set(e.sessionId, { project: e.project ?? "", first: text, lastPrompt: text, prompts: [text], last: e.timestamp });
    } else {
      h.prompts.push(text);
      if (e.timestamp >= h.last) {
        h.last = e.timestamp;
        if (!text.startsWith("/")) h.lastPrompt = text;
      }
      if (!goodTitle(h.first) && goodTitle(text)) h.first = text;
    }
  }
  histCache = { key, map };
  return map;
}

async function claudeRows(tabs: Map<string, TabInfo>): Promise<Row[]> {
  const dir = join(HOME, ".claude", "sessions");
  const regs: any[] = [];
  if (existsSync(dir)) {
    for (const f of readdirSync(dir)) {
      if (!f.endsWith(".json")) continue;
      try {
        const s = JSON.parse(readFileSync(join(dir, f), "utf8"));
        if (s.pid && alive(s.pid)) regs.push(s);
      } catch {}
    }
  }
  const hist = claudeHistory();
  const live = new Set(regs.map((s) => s.sessionId as string));
  const min = cutoff();
  const inactive = [...hist].filter(([id, h]) => !live.has(id) && h.last >= min && h.project);

  const [procs, ...gits] = await Promise.all([
    procInfo(regs.map((s) => s.pid)),
    ...regs.map((s) => gitInfo(s.cwd)),
    ...inactive.map(([, h]) => gitInfo(h.project)),
  ]);

  const rows: Row[] = [];
  regs.forEach((s, i) => {
    const tty = procs.get(s.pid)?.tty;
    const tab = tty ? tabs.get(tty)?.title : undefined;
    const h = hist.get(s.sessionId);
    const title = (tab && stripGlyph(tab)) || (h?.first ? collapse(h.first, 120) : s.name);
    const spinning = tab ? SPINNER.test(tab) : false;
    const status: Status = s.waitingFor ? "needs input" : s.status === "busy" || spinning ? "busy" : "idle";
    const statusAt = s.statusUpdatedAt ?? s.updatedAt ?? s.startedAt ?? Date.now();
    rows.push(
      finish({
        tool: "claude",
        id: s.sessionId,
        pid: s.pid,
        status,
        waitingFor: s.waitingFor,
        cwd: s.cwd,
        ...gits[i],
        title,
        first: h?.first,
        lastPrompt: h?.lastPrompt,
        lastPromptAt: h?.last,
        completedAt: status === "idle" ? statusAt : undefined,
        prompts: h?.prompts ?? [],
        since: statusAt,
        tty,
      }),
    );
  });
  inactive.forEach(([id, h], i) => {
    rows.push(
      finish({
        tool: "claude",
        id,
        status: "inactive",
        cwd: h.project,
        ...gits[regs.length + i],
        title: collapse(h.first, 120) || id.slice(0, 8),
        first: h.first,
        lastPrompt: h.lastPrompt,
        prompts: h.prompts,
        since: h.last,
      }),
    );
  });
  return rows;
}

// ---------------------------------------------------------------- Codex

interface Thread {
  id: string;
  cwd: string;
  git_branch: string | null;
  title: string;
  first_user_message: string;
  rollout_path: string;
  updated_at: number;
}

function codexDb(): string | undefined {
  const dir = join(HOME, ".codex");
  if (!existsSync(dir)) return;
  const files = readdirSync(dir)
    .filter((f) => /^state_\d+\.sqlite$/.test(f))
    .sort((a, b) => Number(b.match(/\d+/)![0]) - Number(a.match(/\d+/)![0]));
  return files[0] ? join(dir, files[0]) : undefined;
}

function codexThreads(): Thread[] {
  const p = codexDb();
  if (!p) return [];
  try {
    const db = new Database(p, { readonly: true });
    try {
      return db
        .query(
          "select id, cwd, git_branch, title, first_user_message, rollout_path, updated_at from threads where archived = 0 order by updated_at desc",
        )
        .all() as Thread[];
    } finally {
      db.close();
    }
  } catch {
    return [];
  }
}

interface CodexProc {
  pid: number;
  cwd: string;
  threadId?: string;
}

// One lsof per process: cwd from the `cwd` fd, thread id from the open
// thread-writer-locks/<id>.lock file the Codex TUI holds while a thread is active.
async function codexProcs(): Promise<CodexProc[]> {
  const pids: number[] = [];
  for (const line of (await sh(["ps", "-eo", "pid=,args="])).split("\n")) {
    const m = line.trim().match(/^(\d+)\s+(.*)$/);
    if (!m) continue;
    const argv = m[2];
    if (!/(^|\/)codex(\s|$)/.test(argv)) continue;
    if (/app-server|remote-control|mcp-server/.test(argv)) continue;
    pids.push(Number(m[1]));
  }
  const infos = await Promise.all(
    pids.map(async (pid) => {
      let cwd: string | undefined;
      let threadId: string | undefined;
      let fd = "";
      for (const line of (await sh(["lsof", "-p", String(pid), "-Fn"])).split("\n")) {
        if (line.startsWith("f")) fd = line.slice(1);
        else if (line.startsWith("n")) {
          const name = line.slice(1);
          if (fd === "cwd") cwd = name;
          const lock = name.match(/thread-writer-locks\/([0-9a-f-]{36})\.lock$/);
          if (lock) threadId = lock[1];
        }
      }
      return { pid, cwd, threadId };
    }),
  );
  const procs: CodexProc[] = [];
  for (const info of infos) {
    if (!info.cwd) continue;
    procs.push({ pid: info.pid, cwd: info.cwd, threadId: info.threadId });
  }
  return procs;
}

interface CodexTail {
  status: Status;
  at: number;
  prompts: string[];
  lastPromptAt?: number;
}

function codexTail(rolloutPath: string): CodexTail {
  let sawOutput = false;
  const prompts: string[] = [];
  let lastPromptAt: number | undefined;
  let result: { status: Status; at: number } | undefined;
  for (const line of tailLines(rolloutPath).reverse()) {
    let e: any;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    const at = e.timestamp ? Date.parse(e.timestamp) : Date.now();
    const t: string = e.payload?.type ?? "";
    if (t === "user_message" && typeof e.payload?.message === "string") {
      prompts.unshift(collapse(e.payload.message, 1000));
      if (!lastPromptAt) lastPromptAt = at;
    }
    if (result) continue;
    if (t.endsWith("_output") || t === "item_completed") sawOutput = true;
    if (/approval_request/.test(t)) result = { status: sawOutput ? "busy" : "needs input", at };
    else if (t === "task_complete" || t === "turn_aborted") result = { status: "idle", at };
    else if (t === "task_started") result = { status: "busy", at };
  }
  return { ...(result ?? { status: "idle", at: Date.now() }), prompts, lastPromptAt };
}

async function codexRows(tabs: Map<string, TabInfo>): Promise<Row[]> {
  const threads = codexThreads();
  const procs = await codexProcs();
  const used = new Set<string>();
  const liveThreads = procs.map((proc) => {
    const t = proc.threadId ? threads.find((t) => t.id === proc.threadId) : undefined;
    if (t) used.add(t.id);
    return t;
  });
  const min = cutoff();
  const inactive = threads.filter((t) => !used.has(t.id) && t.updated_at * 1000 >= min);

  const [infos, ...gits] = await Promise.all([
    procInfo(procs.map((p) => p.pid)),
    ...procs.map((p) => gitInfo(p.cwd)),
    ...inactive.map((t) => gitInfo(t.cwd)),
  ]);

  const rows: Row[] = [];
  procs.forEach((proc, i) => {
    const thread = liveThreads[i];
    const info = infos.get(proc.pid);
    const tty = info?.tty;
    if (thread) {
      const tail = codexTail(thread.rollout_path);
      rows.push(
        finish({
          tool: "codex",
          id: thread.id,
          pid: proc.pid,
          status: tail.status,
          cwd: proc.cwd,
          ...gits[i],
          title: collapse(thread.title, 120) || thread.id.slice(0, 8),
          first: thread.first_user_message || undefined,
          lastPrompt: tail.prompts.at(-1),
          lastPromptAt: tail.lastPromptAt,
          completedAt: tail.status === "idle" ? tail.at : undefined,
          prompts: tail.prompts,
          since: tail.at,
          tty,
        }),
      );
    } else {
      const tab = tty ? tabs.get(tty)?.title.trim() : undefined;
      rows.push(
        finish({
          tool: "codex",
          id: proc.threadId ?? `pid-${proc.pid}`,
          pid: proc.pid,
          status: "idle",
          cwd: proc.cwd,
          ...gits[i],
          title: tab && tab !== basename(proc.cwd) ? tab : "new session, no messages yet",
          prompts: [],
          since: info?.startedAt ?? Date.now(),
          tty,
        }),
      );
    }
  });
  inactive.forEach((t, i) => {
    rows.push(
      finish({
        tool: "codex",
        id: t.id,
        status: "inactive",
        cwd: t.cwd,
        ...gits[procs.length + i],
        ...(t.git_branch ? { branch: t.git_branch } : {}),
        title: collapse(t.title, 120) || t.id.slice(0, 8),
        first: t.first_user_message || undefined,
        prompts: t.first_user_message ? [collapse(t.first_user_message, 1000)] : [],
        since: t.updated_at * 1000,
      }),
    );
  });
  return rows;
}

// ---------------------------------------------------------------- done / seen

// A live idle session whose turn finished after your last prompt is "done"
// until you look at it. Looking = the tab is being viewed right now, or you
// focused it from here, or marked it. Marks persist.
function applyDone(rows: Row[], tabs: Map<string, TabInfo>): Row[] {
  const now = Date.now();
  return rows.map((r) => {
    if (r.status !== "idle" || !r.completedAt || !r.lastPromptAt || r.completedAt <= r.lastPromptAt) return r;
    if (r.tty && tabs.get(r.tty)?.viewed) markSeen(r.id, now);
    const seenAt = state.seen[r.id] ?? 0;
    if (seenAt >= r.completedAt) return r;
    return { ...r, status: "done", search: r.search.replace(/\bidle\b/, "done") };
  });
}

// ---------------------------------------------------------------- collect + filter

const PRIORITY: Record<Status, number> = { "needs input": 0, done: 1, busy: 2, idle: 3, inactive: 4 };

async function collect(): Promise<Row[]> {
  const tabs = await terminalTabs();
  const [claude, codex] = await Promise.all([claudeRows(tabs), codexRows(tabs)]);
  const rows = applyDone([...claude, ...codex], tabs);
  const repoRank = new Map<string, number>();
  for (const r of rows) repoRank.set(r.repo, Math.min(repoRank.get(r.repo) ?? 9, PRIORITY[r.status]));
  rows.sort(
    (a, b) =>
      repoRank.get(a.repo)! - repoRank.get(b.repo)! ||
      a.repo.localeCompare(b.repo) ||
      PRIORITY[a.status] - PRIORITY[b.status] ||
      b.since - a.since,
  );
  return rows;
}

const terms = (q: string) => q.toLowerCase().split(/\s+/).filter(Boolean);

function visibleRows(rows: Row[], showInactive: boolean, query: string): Row[] {
  const t = terms(query);
  // an active search always looks through inactive sessions too
  const base = showInactive || t.length ? rows : rows.filter((r) => r.status !== "inactive");
  return t.length ? base.filter((r) => t.every((x) => r.search.includes(x))) : base;
}

// For a matching row, find the prompt that matched (when title/last prompt did not)
// and return a snippet around the first hit.
function matchSnippet(r: Row, query: string): string | undefined {
  const t = terms(query);
  if (!t.length) return;
  const inTop = (s?: string) => s && t.some((x) => s.toLowerCase().includes(x));
  if (inTop(r.title) || inTop(r.lastPrompt)) return;
  for (const x of t) {
    const p = r.prompts.find((p) => p.toLowerCase().includes(x));
    if (!p) continue;
    const i = p.toLowerCase().indexOf(x);
    const start = Math.max(0, i - 40);
    return (start > 0 ? "…" : "") + p.slice(start, i + 80) + (i + 80 < p.length ? "…" : "");
  }
}

// ---------------------------------------------------------------- render

const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  blue: "\x1b[94m",
  white: "\x1b[97m",
};

const LABEL: Record<Status, string> = { "needs input": "input", done: "done", busy: "busy", idle: "idle", inactive: "inactive" };
const ICON: Record<Tool, string> = { claude: "✳", codex: "⬡" };

function color(status: Status): string {
  switch (status) {
    case "needs input":
      return C.magenta + C.bold;
    case "done":
      return C.blue + C.bold;
    case "busy":
      return C.yellow;
    case "idle":
      return C.green;
    default:
      return C.dim;
  }
}

function toolIcon(tool: Tool, dim = false): string {
  const c = dim ? C.dim : tool === "claude" ? C.yellow : C.white;
  return `${c}${ICON[tool]}${C.reset}`;
}

function trunc(s: string, w: number): string {
  if (w <= 0) return "";
  return s.length > w ? (w > 1 ? s.slice(0, w - 1) + "…" : s.slice(0, w)) : s;
}

const pad = (s: string, w: number) => trunc(s, w).padEnd(w);

function wrap(s: string, w: number, max: number): string[] {
  const words = s.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const word of words) {
    if ((cur + " " + word).trim().length > w) {
      if (cur) lines.push(cur);
      cur = word;
      if (lines.length === max) break;
    } else cur = (cur + " " + word).trim();
  }
  if (cur && lines.length < max) lines.push(cur);
  if (lines.length === max && words.join(" ").length > lines.join(" ").length) lines[max - 1] = trunc(lines[max - 1] + "…", w);
  return lines;
}

interface UiState {
  sel: number;
  showInactive: boolean;
  showDetail: boolean;
  query: string;
  searchMode: boolean;
  msg: string;
  refreshedAt: number;
}

function render(rows: Row[], ui: UiState): { lines: string[]; visible: Row[] } {
  const W = process.stdout.columns || 140;
  const H = process.stdout.rows || 40;
  const visible = visibleRows(rows, ui.showInactive, ui.query);

  // header
  const counts: Record<Status, number> = { "needs input": 0, done: 0, busy: 0, idle: 0, inactive: 0 };
  for (const r of rows) counts[r.status]++;
  const liveN = (tool: Tool) => rows.filter((r) => r.tool === tool && r.status !== "inactive").length;
  const badge = (s: Status, label: string) => `${color(s)}${label} ${counts[s]}${C.reset}`;
  const filterInfo = ui.query ? `   ${C.yellow}⌕ "${ui.query}" ${visible.length} match${visible.length === 1 ? "" : "es"}${C.reset}` : "";
  const header =
    ` ${C.bold}agtc${C.reset}   ${toolIcon("claude")} ${liveN("claude")}  ${toolIcon("codex")} ${liveN("codex")}     ` +
    `${badge("needs input", "needs input")}   ${badge("done", "done")}   ${badge("busy", "busy")}   ${badge("idle", "idle")}   ${badge("inactive", "inactive")}` +
    `${C.dim}   refreshed ${age(ui.refreshedAt)} ago${C.reset}${filterInfo}`;

  // body: one line per session, grouped by repo
  const body: string[] = [];
  const rowLine = new Map<number, number>();
  let repo = "";
  //   ▌ ⎇ ✳  ● idle    Title ..................................... 19h
  const wStatus = 8;
  const wAge = 4;
  const left = 3 + 1 + 2 + 1 + 2 + wStatus + 2; // " ▌ " wt "  " icon "  " status "  "
  const wTitle = Math.max(10, W - left - 2 - wAge - 1);
  visible.forEach((r, i) => {
    if (r.repo !== repo) {
      repo = r.repo;
      if (body.length) body.push("");
      const n = visible.filter((x) => x.repo === repo).length;
      const label = ` ${repo} `;
      const rule = "─".repeat(Math.max(0, W - label.length - 14));
      body.push(`${C.bold}${C.cyan}${label}${C.reset}${C.dim}${rule} ${n} session${n === 1 ? "" : "s"}${C.reset}`);
    }
    rowLine.set(i, body.length);
    const isSel = i === ui.sel;
    const inactive = r.status === "inactive";
    const bar = isSel ? `${C.cyan}▌${C.reset}` : " ";
    const title = pad(r.title, wTitle);
    const titleColored = isSel ? `${C.bold}${C.white}${title}${C.reset}` : inactive ? `${C.dim}${title}${C.reset}` : r.status === "done" ? `${C.bold}${title}${C.reset}` : title;
    const wt = r.worktree ? `${inactive ? C.dim : C.cyan}⎇${C.reset}` : " ";
    body.push(
      ` ${bar} ${wt}  ${toolIcon(r.tool, inactive)}  ${color(r.status)}${pad(LABEL[r.status], wStatus)}${C.reset}  ${titleColored}  ${C.dim}${pad(age(r.since), wAge)}${C.reset}`,
    );
    const snippet = matchSnippet(r, ui.query);
    if (snippet) body.push(` ${bar} ${" ".repeat(left - 3)}${C.yellow}⌕ ${trunc(snippet, W - left - 4)}${C.reset}`);
  });
  if (!visible.length) {
    body.push(`${C.dim}   ${ui.query ? "no sessions match" : `nothing running${ui.showInactive ? "" : " (press a to show inactive)"}`}${C.reset}`);
  }

  // detail pane for the selected row
  const detail: string[] = [];
  const r = visible[ui.sel];
  if (ui.showDetail && r) {
    const line = (s = "") => detail.push(s ? `  ${s}` : "");
    detail.push(`${C.dim}${"─".repeat(W)}${C.reset}`);
    line();
    line(`${C.bold}${C.white}${trunc(r.title, W - 4)}${C.reset}`);
    const waiting = r.status === "needs input" && r.waitingFor ? `: ${r.waitingFor}` : "";
    const statusWord = r.status === "done" ? "done, not seen yet" : r.status;
    line(
      `${color(r.status)}${statusWord}${waiting}${C.reset}${C.dim} for ${age(r.since)}${C.reset}   ${toolIcon(r.tool)} ${r.tool}` +
        `${C.dim}${r.pid ? `   pid ${r.pid}` : ""}${r.tty ? `   ${r.tty}` : ""}${C.reset}`,
    );
    line();
    line(`${C.dim}${trunc(tilde(r.cwd), W - 4)}${C.reset}`);
    line(
      r.worktree
        ? `${C.cyan}⎇ ${r.worktree}${C.reset}${C.dim}${r.branch ? `  on ${r.branch}` : ""}${C.reset}`
        : `${C.dim}⌂ main checkout${r.branch ? `  on ${r.branch}` : ""}${C.reset}`,
    );
    if (r.lastPrompt) {
      line();
      wrap(r.lastPrompt, W - 8, 2).forEach((l, i) => line(`${i === 0 ? "↳ " : "  "}${l}`));
    }
    line();
  }

  const footer = ui.searchMode
    ? ` ${C.yellow}/ ${ui.query}${C.reset}${C.bold}▏${C.reset}${C.dim}   type to filter · ↑↓ move · enter keep · esc clear${C.reset}`
    : `${C.dim} ↑↓/jk move   / search${ui.query ? " (esc clears)" : ""}   enter focus tab   m seen   M all seen   c copy resume   a inactive:${ui.showInactive ? "on" : "off"}   d detail:${ui.showDetail ? "on" : "off"}   q quit${C.reset}` +
      (ui.msg ? `   ${C.yellow}${ui.msg}${C.reset}` : "");

  const maxBody = Math.max(3, H - 2 - detail.length - 1);
  let start = 0;
  const selLine = rowLine.get(ui.sel) ?? 0;
  if (body.length > maxBody) start = Math.min(Math.max(0, selLine - Math.floor(maxBody / 2)), body.length - maxBody);
  const slice = body.slice(start, start + maxBody);
  while (slice.length < maxBody) slice.push("");

  return { lines: [header, "", ...slice, ...detail, footer], visible };
}

function resumeCommand(r: Row): string {
  const cd = `cd ${JSON.stringify(r.cwd)}`;
  return r.tool === "claude" ? `${cd} && claude --resume ${r.id}` : `${cd} && codex resume ${r.id}`;
}

// ---------------------------------------------------------------- main

loadState();

const ui: UiState = {
  sel: 0,
  showInactive: flag("--inactive"),
  showDetail: true,
  query: "",
  searchMode: false,
  msg: "",
  refreshedAt: Date.now(),
};

if (flag("--json")) {
  const rows = (await collect()).map(({ search, prompts, ...r }) => r);
  console.log(JSON.stringify(rows, null, 2));
  process.exit(0);
}

if (flag("--once")) {
  console.log(render(await collect(), { ...ui, showInactive: true }).lines.join("\n"));
  process.exit(0);
}

let rows: Row[] = [];
let msgTimer: ReturnType<typeof setTimeout> | undefined;
let refreshing = false;
const out = process.stdout;

function say(m: string) {
  ui.msg = m;
  if (msgTimer) clearTimeout(msgTimer);
  msgTimer = setTimeout(() => {
    ui.msg = "";
    draw();
  }, 3000);
  draw();
}

function clampSel() {
  const n = visibleRows(rows, ui.showInactive, ui.query).length;
  ui.sel = Math.min(Math.max(0, ui.sel), Math.max(0, n - 1));
}

function draw() {
  out.write("\x1b[H\x1b[2J" + render(rows, ui).lines.join("\n"));
}

async function refresh() {
  if (refreshing) return;
  refreshing = true;
  try {
    const prevDone = new Set(rows.filter((r) => r.status === "done").map((r) => r.id));
    let next = await collect();
    if (stateIsNew && !rows.length) {
      // first ever run: treat everything already finished as seen, so the
      // list starts clean and only new completions light up
      for (const r of next) if (r.status === "done") markSeen(r.id);
      stateIsNew = false;
      next = await collect();
    }
    rows = next;
    ui.refreshedAt = Date.now();
    clampSel();
    draw();
    if (BELL && rows.some((r) => r.status === "done" && !prevDone.has(r.id))) out.write("\x07");
  } finally {
    refreshing = false;
  }
}

function markRowSeen(r: Row) {
  markSeen(r.id);
  rows = rows.map((x) => (x.id === r.id && x.status === "done" ? { ...x, status: "idle" } : x));
}

// Set up stdin before the first stdout write: Bun otherwise delays and
// coalesces raw-mode key reads. Chunks may still carry several keys, so split.
process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk: string) => {
  for (const key of splitKeys(chunk)) handleKey(key);
});

out.write("\x1b[?1049h\x1b[?25l");
process.on("exit", () => out.write("\x1b[?25h\x1b[?1049l"));
process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));
out.on("resize", draw);

function splitKeys(chunk: string): string[] {
  const keys: string[] = [];
  let i = 0;
  while (i < chunk.length) {
    if (chunk[i] === "\x1b" && chunk[i + 1] === "[") {
      let j = i + 2;
      while (j < chunk.length && !/[A-Za-z~]/.test(chunk[j])) j++;
      keys.push(chunk.slice(i, j + 1));
      i = j + 1;
    } else {
      keys.push(chunk[i]);
      i++;
    }
  }
  return keys;
}

function handleSearchKey(key: string) {
  switch (key) {
    case "\x03":
      process.exit(0);
    case "\x1b":
      ui.query = "";
      ui.searchMode = false;
      break;
    case "\r":
      ui.searchMode = false;
      break;
    case "\x7f":
    case "\b":
      ui.query = ui.query.slice(0, -1);
      break;
    case "\x15":
      ui.query = "";
      break;
    case "\x1b[A":
      ui.sel--;
      break;
    case "\x1b[B":
      ui.sel++;
      break;
    default:
      if (key.length === 1 && key >= " ") ui.query += key;
      else return;
  }
  clampSel();
  draw();
}

function handleKey(key: string) {
  if (ui.searchMode) return handleSearchKey(key);
  const vis = visibleRows(rows, ui.showInactive, ui.query);
  const row = vis[ui.sel];
  switch (key) {
    case "q":
    case "\x03":
      process.exit(0);
    case "/":
      ui.searchMode = true;
      break;
    case "\x1b":
      ui.query = "";
      ui.sel = 0;
      break;
    case "j":
    case "\x1b[B":
      ui.sel++;
      break;
    case "k":
    case "\x1b[A":
      ui.sel--;
      break;
    case "g":
      ui.sel = 0;
      break;
    case "G":
      ui.sel = vis.length - 1;
      break;
    case "a":
      ui.showInactive = !ui.showInactive;
      ui.sel = 0;
      break;
    case "d":
      ui.showDetail = !ui.showDetail;
      break;
    case "m":
      if (row) markRowSeen(row);
      break;
    case "M":
      for (const r of rows) if (r.status === "done") markRowSeen(r);
      say("all marked seen");
      return;
    case "r":
      say("refreshing…");
      void refresh();
      return;
    case "c":
      if (row) {
        Bun.spawnSync(["pbcopy"], { stdin: new TextEncoder().encode(resumeCommand(row)) });
        say(`copied: ${resumeCommand(row)}`);
      }
      return;
    case "\r":
      if (!row) break;
      if (row.tty) {
        const tty = row.tty;
        markRowSeen(row);
        say(`focusing ${tty}…`);
        void focusTab(tty).then((ok) => say(ok ? `focused ${tty}` : `tab for ${tty} not found`));
      } else say(`not in a Terminal tab. resume: ${resumeCommand(row)}`);
      return;
    default:
      return;
  }
  clampSel();
  draw();
}

draw();
void refresh();
setInterval(() => void refresh(), POLL_MS);
