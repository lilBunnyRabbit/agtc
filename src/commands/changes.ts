import { appendFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Target, commentBlock, countComments, revdiffArgs } from "../review/comments";
import { ANSI } from "../tui/ansi";
import { type ChangesInfo, type Pick, parseLog, renderChanges, targets } from "../tui/changes";
import { Key } from "../tui/keys";
import { type Screen, openScreen } from "../tui/terminal";

const MAX_COMMITS = 300;

function commits(dir: string): Target[] {
  const log = Bun.spawnSync(["git", "-C", dir, "log", `-n${MAX_COMMITS}`, "--format=%h%x1f%s%x1f%ct%x1f%p"], { stderr: "ignore" });
  return log.exitCode === 0 ? parseLog(log.stdout.toString()) : [];
}

/** revdiff takes the whole terminal, so the list steps aside while it runs and comes back after. */
function visit(info: ChangesInfo, target: Target): number {
  const run = join(tmpdir(), `agtc-visit-${process.pid}-${Date.now()}.md`);
  Bun.spawnSync(revdiffArgs(target, info.keys, run), { cwd: info.dir, stdio: ["inherit", "inherit", "inherit"] });
  const annotations = existsSync(run) ? readFileSync(run, "utf8") : "";
  rmSync(run, { force: true });
  if (!countComments(annotations)) return 0;
  appendFileSync(info.output, commentBlock(target, annotations));
  return countComments(annotations);
}

export function changesScreen(packed: string | undefined): Promise<number> {
  const info = unpack(packed);
  if (!info) {
    console.log("agtc changes runs from agtc: v on a row opens it");
    return Promise.resolve(1);
  }
  const list = targets(info, commits(info.dir));
  const pick: Pick = { selected: 0, comments: 0 };
  return new Promise((done) => {
    const out = process.stdout;
    const draw = () => out.write(ANSI.clearScreen + renderChanges(info, list, pick, out.columns, out.rows).join("\n"));
    const onKey = (key: string) => {
      const step = key === Key.up || key === "j" ? -1 : key === Key.down || key === "k" ? 1 : 0;
      if (step) {
        pick.selected = Math.max(0, Math.min(list.length - 1, pick.selected + step));
        return draw();
      }
      if (key === "g" || key === "G") {
        pick.selected = key === "g" ? 0 : list.length - 1;
        return draw();
      }
      if (key === Key.enter && list[pick.selected]) {
        screen.close();
        pick.comments += visit(info, list[pick.selected]);
        screen = openScreen({ onKey, onResize: draw });
        return draw();
      }
      if (key === "Q") rmSync(info.output, { force: true });
      if (key !== Key.escape && key !== "q" && key !== "Q") return;
      screen.close();
      done(0);
    };
    let screen: Screen = openScreen({ onKey, onResize: draw });
    draw();
  });
}

function unpack(packed: string | undefined): ChangesInfo | undefined {
  try {
    const info = JSON.parse(Buffer.from(packed ?? "", "base64url").toString());
    return info?.dir && info.output && info.keys ? info : undefined;
  } catch {
    return undefined;
  }
}
