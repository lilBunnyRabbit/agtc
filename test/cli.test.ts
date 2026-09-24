import { describe, expect, test } from "bun:test";
import { parseArgs } from "../src/cli";

describe("parseArgs", () => {
  test("no arguments is the tui with defaults", () => {
    const options = parseArgs([]);
    expect(options.mode).toBe("tui");
    expect(options.days).toBe(2);
    expect(options.intervalMs).toBe(2000);
    expect(options.stagePercent).toBe(70);
    expect(options.jump).toBe("tmux");
    expect(options.notify).toBe(true);
    expect(options.dir).toBe(process.cwd());
  });

  test("help and version win over everything", () => {
    expect(parseArgs(["graph", "--help"]).mode).toBe("help");
    expect(parseArgs(["-v"]).mode).toBe("version");
  });

  test("subcommands map to modes, unknown ones to help", () => {
    for (const command of ["update", "tmux", "graph", "worktrees", "attach", "send"]) expect(parseArgs([command]).mode as string).toBe(command);
    expect(parseArgs(["bogus"]).mode).toBe("help");
  });

  test("--json and --once without a command", () => {
    expect(parseArgs(["--json"]).mode).toBe("json");
    expect(parseArgs(["--once"]).mode).toBe("once");
  });

  test("numbers fall back when invalid", () => {
    expect(parseArgs(["--days", "5"]).days).toBe(5);
    expect(parseArgs(["--days", "-1"]).days).toBe(2);
    expect(parseArgs(["--days", "abc"]).days).toBe(2);
    expect(parseArgs(["--stage", "200"]).stagePercent).toBe(95);
  });

  test("worktrees actions and positionals", () => {
    const prune = parseArgs(["worktrees", "prune", "/tmp/x"]);
    expect(prune.action).toBe("prune");
    expect(prune.dir).toBe("/tmp/x");

    const rm = parseArgs(["worktrees", "rm", "feature", "/tmp/x", "--force"]);
    expect(rm.action).toBe("rm");
    expect(rm.name).toBe("feature");
    expect(rm.dir).toBe("/tmp/x");
    expect(rm.force).toBe(true);

    const plain = parseArgs(["worktrees", "/tmp/y"]);
    expect(plain.action).toBeUndefined();
    expect(plain.dir).toBe("/tmp/y");
  });

  test("a flag value that looks like a flag is not taken", () => {
    expect(parseArgs(["--worktrees", "--inactive"]).worktrees).toBeUndefined();
    expect(parseArgs(["--worktrees", "--inactive"]).showInactive).toBe(true);
  });

  test("send options", () => {
    const options = parseArgs(["send", "/tmp/z", "--file", "a.ts", "--row", "12"]);
    expect(options.mode).toBe("send");
    expect(options.dir).toBe("/tmp/z");
    expect(options.file).toBe("a.ts");
    expect(options.row).toBe("12");
  });

  test("jump accepts only zed", () => {
    expect(parseArgs(["--jump", "zed"]).jump).toBe("zed");
    expect(parseArgs(["--jump", "vim"]).jump).toBe("tmux");
  });
});
