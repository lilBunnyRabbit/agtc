import { describe, expect, test } from "bun:test";
import { resumeCommand, resumeInvocation, workDir } from "../src/model/session";
import { sortSessions } from "../src/model/sessions";
import { session } from "./fixtures";

describe("sortSessions", () => {
  test("repos alphabetically, live by start then inactive newest first", () => {
    const sorted = sortSessions([
      session({ repo: "b", status: "busy", startedAt: 20, id: "b-live-2" }),
      session({ repo: "a", status: "inactive", since: 5, id: "a-old" }),
      session({ repo: "a", status: "inactive", since: 9, id: "a-new" }),
      session({ repo: "b", status: "idle", startedAt: 10, id: "b-live-1" }),
      session({ repo: "a", status: "busy", startedAt: 30, id: "a-live" }),
    ]);
    expect(sorted.map((s) => s.id)).toEqual(["a-live", "a-new", "a-old", "b-live-1", "b-live-2"]);
  });

  test("a reviewer nests under its subject, an orphan stays put", () => {
    const sorted = sortSessions([
      session({ repo: "a", status: "busy", startedAt: 1, id: "subject" }),
      session({ repo: "a", status: "busy", startedAt: 2, id: "other" }),
      session({ repo: "a", status: "busy", startedAt: 3, id: "reviewer", reviewOf: "subject" }),
      session({ repo: "a", status: "busy", startedAt: 4, id: "orphan", reviewOf: "gone" }),
    ]);
    expect(sorted.map((s) => s.id)).toEqual(["subject", "reviewer", "other", "orphan"]);
  });
});

describe("resume", () => {
  test("invocation per tool, read-only for reviewers", () => {
    expect(resumeInvocation({ tool: "claude", id: "abc" })).toBe("claude --resume 'abc'");
    expect(resumeInvocation({ tool: "codex", id: "abc" })).toBe("codex resume 'abc'");
    expect(resumeInvocation({ tool: "codex", id: "abc", reviewOf: "x" })).toBe("codex resume --sandbox read-only --ask-for-approval never 'abc'");
    expect(resumeInvocation({ tool: "claude", id: "abc", reviewOf: "x" })).toContain("--disallowedTools");
  });

  test("command quotes the cwd", () => {
    expect(resumeCommand(session({ tool: "claude", id: "abc", cwd: "/it's here" }))).toBe("cd '/it'\\''s here' && claude --resume 'abc'");
  });

  test("workDir prefers the checkout root", () => {
    expect(workDir(session({ cwd: "/a/b", root: "/a" }))).toBe("/a");
    expect(workDir(session({ cwd: "/a/b", root: undefined }))).toBe("/a/b");
  });
});
