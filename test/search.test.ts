import { describe, expect, test } from "bun:test";
import { buildSearchText, filterSessions, matchSnippet } from "../src/model/search";
import { session } from "./fixtures";

describe("search", () => {
  test("buildSearchText lowercases everything searchable", () => {
    const text = buildSearchText(session({ title: "Fix Header", branch: "Feat/X", prompts: ["Do It"], pid: 42 }));
    expect(text).toContain("fix header");
    expect(text).toContain("feat/x");
    expect(text).toContain("do it");
    expect(text).toContain("42");
  });

  test("filterSessions hides inactive unless shown or searched", () => {
    const live = session({ status: "busy", searchText: "alpha" });
    const old = session({ status: "inactive", searchText: "beta" });
    expect(filterSessions([live, old], { showInactive: false, query: "" })).toEqual([live]);
    expect(filterSessions([live, old], { showInactive: true, query: "" })).toEqual([live, old]);
    expect(filterSessions([live, old], { showInactive: false, query: "beta" })).toEqual([old]);
    expect(filterSessions([live, old], { showInactive: false, query: "alpha zzz" })).toEqual([]);
  });

  test("matchSnippet only when the hit is in an older prompt", () => {
    const s = session({ title: "Header", lastPrompt: "push it", prompts: ["make the sidebar overflow safe", "push it"] });
    expect(matchSnippet(s, "header")).toBeUndefined();
    expect(matchSnippet(s, "push")).toBeUndefined();
    expect(matchSnippet(s, "overflow")).toBe("make the sidebar overflow safe");
    expect(matchSnippet(s, "")).toBeUndefined();
  });
});
