import { describe, expect, test } from "bun:test";
import { readOnlyFlags, reviewerFor } from "../src/model/tools";
import { reviewPrompt, reviewerCommand } from "../src/review/prompt";
import { resolveSpec, specPath } from "../src/review/spec";

describe("review", () => {
  test("the other tool reviews by default", () => {
    expect(reviewerFor("claude")).toBe("codex");
    expect(reviewerFor("codex")).toBe("claude");
  });

  test("read-only flags per tool", () => {
    expect(readOnlyFlags("codex")).toBe("--sandbox read-only --ask-for-approval never");
    const claude = readOnlyFlags("claude");
    expect(claude).toContain("--disallowedTools");
    expect(claude).toContain("Edit,Write");
    expect(claude).toContain("--allowedTools");
  });

  test("reviewer commands read the prompt from its file", () => {
    expect(reviewerCommand("claude", "id-1", "/p/review-id-1.md")).toBe(`claude "$(cat '/p/review-id-1.md')" --session-id id-1 ${readOnlyFlags("claude")}`);
    expect(reviewerCommand("codex", "id-1", "/p/review-id-1.md")).toBe(`codex ${readOnlyFlags("codex")} "$(cat '/p/review-id-1.md')"`);
  });

  test("the prompt scopes the diff to the base when known", () => {
    expect(reviewPrompt({ spec: "S", base: "origin/main" })).toContain("git diff origin/main...HEAD");
    expect(reviewPrompt({ spec: "S" })).toContain("git log");
    expect(reviewPrompt({ spec: "S" })).toContain("## Spec\n\nS\n");
  });

  test("resolveSpec: text as is, a path's content, empty is nothing", () => {
    expect(resolveSpec("  plain text  ")).toBe("plain text");
    expect(resolveSpec("   ")).toBeUndefined();
    expect(resolveSpec("@/definitely/missing/file.md")).toBe("@/definitely/missing/file.md");
    expect(resolveSpec(import.meta.path)).toContain("resolveSpec");
    expect(resolveSpec(`@${import.meta.path}`)).toContain("resolveSpec");
  });
});

describe("specPath", () => {
  test("keyed by checkout and branch, legacy id file as fallback", () => {
    const keyed = specPath({ id: "abc", cwd: "/r/x", root: "/r", branch: "feat/a" });
    expect(keyed.endsWith("/r--feat-a.md")).toBe(true);
    expect(specPath({ id: "abc", cwd: "/r/x", root: "/r" }).endsWith("/r--detached.md")).toBe(true);
  });
});
