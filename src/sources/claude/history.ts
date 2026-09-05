import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { readJsonLines } from "../../lib/files";
import { collapse } from "../../lib/text";
import { CLAUDE_DIR } from "../../paths";
import { PROMPT_MAX_LENGTH } from "../../session";

/** Everything you typed into one Claude session, from ~/.claude/history.jsonl. */
export interface ClaudeHistory {
  /** Working directory the session ran in. */
  project: string;
  /** First substantial prompt; used as a title. */
  firstPrompt: string;
  /** Latest prompt that is not a slash command. */
  lastPrompt: string;
  prompts: string[];
  lastAt: number;
}

interface HistoryLine {
  sessionId?: string;
  timestamp?: number;
  project?: string;
  display?: string;
}

const HISTORY_FILE = join(CLAUDE_DIR, "history.jsonl");
const MIN_TITLE_LENGTH = 10;

const isSlashCommand = (prompt: string) => prompt.startsWith("/");
const makesGoodTitle = (prompt: string) => !isSlashCommand(prompt) && prompt.trim().length >= MIN_TITLE_LENGTH;

let cache: { fingerprint: string; histories: Map<string, ClaudeHistory> } | undefined;

/** Histories keyed by session id. Re-parsed only when the file changes. */
export function readClaudeHistory(): Map<string, ClaudeHistory> {
  if (!existsSync(HISTORY_FILE)) return new Map();
  const stat = statSync(HISTORY_FILE);
  const fingerprint = `${stat.size}:${stat.mtimeMs}`;
  if (cache?.fingerprint === fingerprint) return cache.histories;

  const histories = new Map<string, ClaudeHistory>();
  for (const line of readJsonLines<HistoryLine>(HISTORY_FILE)) {
    if (!line.sessionId || !line.timestamp) continue;
    const prompt = collapse(String(line.display ?? ""), PROMPT_MAX_LENGTH);
    const history = histories.get(line.sessionId);
    if (!history) {
      histories.set(line.sessionId, { project: line.project ?? "", firstPrompt: prompt, lastPrompt: prompt, prompts: [prompt], lastAt: line.timestamp });
      continue;
    }
    history.prompts.push(prompt);
    if (line.timestamp >= history.lastAt) {
      history.lastAt = line.timestamp;
      if (!isSlashCommand(prompt)) history.lastPrompt = prompt;
    }
    if (!makesGoodTitle(history.firstPrompt) && makesGoodTitle(prompt)) history.firstPrompt = prompt;
  }

  cache = { fingerprint, histories };
  return histories;
}
