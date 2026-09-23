import { homedir } from "node:os";
import { join } from "node:path";

export const HOME = homedir();
export const CLAUDE_DIR = join(HOME, ".claude");
export const CODEX_DIR = join(HOME, ".codex");
export const STATE_FILE = join(HOME, ".cache", "agtc", "state.json");
/** Prompts handed to agents started from agtc, read back by the shell command that starts them. */
export const PROMPTS_DIR = join(HOME, ".cache", "agtc", "prompts");
