import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { untildify } from "../lib/text";
import { HOME, SPECS_DIR } from "../paths";

export const specPath = (sessionId: string) => join(SPECS_DIR, `${sessionId}.md`);

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
