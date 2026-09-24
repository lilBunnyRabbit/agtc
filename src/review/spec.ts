import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { untildify } from "../lib/text";
import { workDir } from "../model/session";
import { HOME, SPECS_DIR } from "../paths";

const slug = (text: string) => text.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");

/**
 * Keyed by checkout and branch, so the spec survives a resume, a second session in the same
 * worktree and a Codex thread whose id arrives late. A file written under the session id by an
 * earlier version still counts.
 */
export function specPath(session: { id: string; cwd: string; root?: string; branch?: string }): string {
  const keyed = join(SPECS_DIR, `${slug(workDir(session))}--${slug(session.branch ?? "detached")}.md`);
  const legacy = join(SPECS_DIR, `${session.id}.md`);
  return !existsSync(keyed) && existsSync(legacy) ? legacy : keyed;
}

export function specRequest(path: string): string {
  mkdirSync(SPECS_DIR, { recursive: true });
  return `Write the spec for the work in this session to ${path}. It is for a reviewer who sees only the code, not this conversation: what was asked, what the result must do, constraints, what is explicitly out of scope. Facts only, no implementation notes, no reasoning. Under 40 lines. Reply with just the path when done.\n`;
}

export function resolveSpec(answer: string): string | undefined {
  const value = answer.trim();
  try {
    return readFileSync(untildify(value.replace(/^@/, ""), HOME), "utf8").trim() || undefined;
  } catch {
    return value || undefined;
  }
}
