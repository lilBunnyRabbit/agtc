import { describe, expect, test } from "bun:test";
import { commentBlock, commentsMessage, countComments, revdiffArgs } from "../src/review/comments";
import { stripAnsi } from "../src/tui/ansi";
import { parseLog, renderChanges, targets } from "../src/tui/changes";

const annotations = "## math.ts:2 (+)\nuse strict equality\n\n## store.ts:18-24 (-)\nwhy did this go\n## not a heading inside text\n";
const info = { dir: "/r", where: "~/r · feat", keys: "/k", output: "/o", base: "origin/main", ahead: 2, uncommitted: { files: 3, insertions: 10, deletions: 4 } };
const log = "abc1234\x1ffeat: second\x1f1700000000\x1fdef5678\nfirst00\x1finitial\x1f1690000000\x1f\n";

describe("review targets", () => {
  test("uncommitted, the branch against its base, a commit against its parent, a first commit against nothing", () => {
    const [second, first] = parseLog(log);
    expect(revdiffArgs({ kind: "uncommitted" }, "/k", "/o")).toEqual(["revdiff", "--untracked", "--start-at-change", "--keys", "/k", "--output", "/o"]);
    expect(revdiffArgs({ kind: "branch", base: "origin/main" }, "/k", "/o").slice(-1)).toEqual(["origin/main"]);
    expect(revdiffArgs(second, "/k", "/o").slice(-2)).toEqual(["abc1234^", "abc1234"]);
    expect(revdiffArgs(first, "/k", "/o").slice(-2)).toEqual(["4b825dc642cb6eb9a060e54bf8d69288fbee4904", "first00"]);
  });

  test("the list leads with uncommitted work and the branch, only when there is some", () => {
    const commits = parseLog(log);
    expect(targets(info, commits).map((t) => t.kind)).toEqual(["uncommitted", "branch", "commit", "commit"]);
    expect(targets({ ...info, ahead: 0, uncommitted: { files: 0, insertions: 0, deletions: 0 } }, commits).map((t) => t.kind)).toEqual(["commit", "commit"]);
  });

  test("keeps its height and marks the selection", () => {
    const list = targets(info, parseLog(log.repeat(40)));
    for (const selected of [0, 40, list.length - 1]) {
      const lines = renderChanges(info, list, { selected, comments: 2 }, 100, 30).map(stripAnsi);
      expect(lines.length).toBeLessThanOrEqual(30);
      expect(lines.filter((line) => line.includes("▌"))).toHaveLength(1);
    }
    expect(renderChanges(info, list, { selected: 0, comments: 2 }, 100, 30).map(stripAnsi).join("\n")).toContain("2 comments so far");
  });
});

describe("comments", () => {
  test("each visit says what it was on, and only ## headings count", () => {
    const block = commentBlock({ kind: "commit", sha: "abc1234", subject: "feat: x", parent: true, at: 0 }, annotations);
    expect(block).toStartWith('### On commit abc1234 "feat: x"\n\n## math.ts:2 (+)');
    expect(countComments(block)).toBe(3);
    expect(countComments("")).toBe(0);
  });

  test("the message counts the comments and keeps them as written", () => {
    const message = commentsMessage("## math.ts:2 (+)\nuse strict equality\n");
    expect(message).toStartWith("My review of your changes, 1 comment.");
    expect(message).toEndWith("\n\n## math.ts:2 (+)\nuse strict equality\n");
  });
});
