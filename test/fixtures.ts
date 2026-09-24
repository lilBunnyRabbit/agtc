import type { Session } from "../src/model/session";

let counter = 0;

export function session(overrides: Partial<Session> = {}): Session {
  const n = ++counter;
  const base: Session = {
    tool: "claude",
    id: `session-${n}`,
    status: "idle",
    cwd: `/repo/${n}`,
    root: `/repo/${n}`,
    mainRoot: `/repo/${n}`,
    roots: [`/repo/${n}`],
    repo: "repo",
    title: `Session ${n}`,
    prompts: [],
    since: 1_000_000 + n,
    searchText: "",
    ...overrides,
  };
  return { ...base, searchText: overrides.searchText ?? `${base.title} ${base.repo} ${base.status}`.toLowerCase() };
}
