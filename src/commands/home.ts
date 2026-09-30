import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { shellQuote } from "../lib/shell";
import { untildify } from "../lib/text";
import { HOME } from "../paths";
import { agtcShell } from "../tmux/env";
import { ANSI } from "../tui/ansi";
import { HOME_WIDTH, type HomeChoice, type HomeInfo, homeChoice, homeKey, renderHome } from "../tui/home";
import { openScreen } from "../tui/terminal";
import { popupBehind, popupFrame, popupPlace } from "./menu";

const PASTE_ON = "\x1b[?2004h";
const PASTE_OFF = "\x1b[?2004l";
const TITLE = "#[fg=cyan,bold,reverse] new #[default]";

export async function homeInPopup(over: string, form: Omit<HomeInfo, "answer">): Promise<HomeChoice | undefined> {
  const info: HomeInfo = { ...form, answer: join(tmpdir(), `agtc-home-${randomUUID()}`) };
  const [width, height] = [HOME_WIDTH + 2, renderHome(info).length + 2];
  const command = `${agtcShell()} home ${shellQuote(Buffer.from(JSON.stringify(info)).toString("base64url"))}`;
  await popupBehind(over, [...popupFrame(width, height), ...popupPlace(width, height), "-T", TITLE, command]);
  if (!existsSync(info.answer)) return undefined;
  const choice = JSON.parse(readFileSync(info.answer, "utf8")) as HomeChoice;
  rmSync(info.answer, { force: true });
  return choice;
}

export function homeScreen(packed: string | undefined): Promise<number> {
  const info = unpack(packed);
  if (!info) {
    console.log("agtc home runs from agtc: n in the hub or option-n from any pane opens it");
    return Promise.resolve(1);
  }
  return new Promise((done) => {
    const out = process.stdout;
    const draw = () => out.write(ANSI.clearScreen + renderHome(info).join("\n"));
    const leave = () => {
      out.write(PASTE_OFF);
      screen.close();
      done(0);
    };
    const screen = openScreen({
      onResize: draw,
      onKey: (key) => {
        const outcome = homeKey(info, key);
        if (outcome === "ignored") return;
        if (outcome === "edited") return draw();
        if (outcome === "cancel") return leave();
        const choice = homeChoice(info);
        if (!existsSync(untildify(choice.dir, HOME))) {
          info.problem = `no such directory: ${choice.dir}`;
          return draw();
        }
        writeFileSync(info.answer, JSON.stringify(choice));
        leave();
      },
    });
    out.write(PASTE_ON);
    draw();
  });
}

function unpack(packed: string | undefined): HomeInfo | undefined {
  try {
    const info = JSON.parse(Buffer.from(packed ?? "", "base64url").toString());
    return info?.start && info.answer ? info : undefined;
  } catch {
    return undefined;
  }
}
