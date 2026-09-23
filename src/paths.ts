import { homedir } from "node:os";
import { join } from "node:path";

export const HOME = homedir();
export const CLAUDE_DIR = join(HOME, ".claude");
export const CODEX_DIR = join(HOME, ".codex");
export const STATE_FILE = join(HOME, ".cache", "agtc", "state.json");
/** Prompts handed to agents started from agtc, read back by the shell command that starts them. */
export const PROMPTS_DIR = join(HOME, ".cache", "agtc", "prompts");
/** Specs the author of a session writes on request, one per session, read back by `V`. */
export const SPECS_DIR = join(HOME, ".cache", "agtc", "specs");
/** The key reference `?` shows in a popup, rewritten on every open. */
export const HELP_FILE = join(HOME, ".cache", "agtc", "help.txt");
/** The reviewer report `f` shows in a popup, rewritten on every open. */
export const REPORT_FILE = join(HOME, ".cache", "agtc", "report.txt");
