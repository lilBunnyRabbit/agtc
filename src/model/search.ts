import type { Session, SessionInput } from "./session";

export interface SessionFilter {
  showInactive: boolean;
  query: string;
}

const SNIPPET_BEFORE = 40;
const SNIPPET_AFTER = 80;

export function buildSearchText(session: SessionInput): string {
  const { title, firstPrompt, lastPrompt, prompts, worktree, branch, cwd, repo, tool, status, waitingFor, id, pid } = session;
  return [title, firstPrompt, lastPrompt, ...prompts, worktree, branch, cwd, repo, tool, status, waitingFor, id, pid]
    .filter((value) => value !== undefined && value !== "")
    .join("\n")
    .toLowerCase();
}

const queryTerms = (query: string) => query.toLowerCase().split(/\s+/).filter(Boolean);

/** A search always looks through inactive sessions too. */
export function filterSessions(sessions: Session[], { showInactive, query }: SessionFilter): Session[] {
  const terms = queryTerms(query);
  const live = sessions.filter((s) => s.status !== "inactive");
  const pool = showInactive || terms.length ? sessions : live;
  return terms.length ? pool.filter((s) => terms.every((term) => s.searchText.includes(term))) : pool;
}

export function matchSnippet(session: Session, query: string): string | undefined {
  const terms = queryTerms(query);
  if (!terms.length) return undefined;
  const contains = (text: string | undefined) => !!text && terms.some((term) => text.toLowerCase().includes(term));
  if (contains(session.title) || contains(session.lastPrompt)) return undefined;

  for (const term of terms) {
    const prompt = session.prompts.find((p) => p.toLowerCase().includes(term));
    if (!prompt) continue;
    const index = prompt.toLowerCase().indexOf(term);
    const start = Math.max(0, index - SNIPPET_BEFORE);
    const end = index + SNIPPET_AFTER;
    return (start > 0 ? "…" : "") + prompt.slice(start, end) + (end < prompt.length ? "…" : "");
  }
  return undefined;
}
