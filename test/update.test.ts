import { describe, expect, test } from "bun:test";
import { detectInstall } from "../src/commands/update";

describe("detectInstall", () => {
  test("recognises where agtc runs from", () => {
    expect(detectInstall("/Users/u/.bun/install/global/node_modules/@lilbunnyrabbit/agtc")).toBe("bun-global");
    expect(detectInstall("/Users/u/.bun/install/cache/@lilbunnyrabbit/agtc@1.0.0")).toBe("bunx");
    expect(detectInstall("/usr/lib/node_modules/@lilbunnyrabbit/agtc")).toBe("npm-global");
    expect(detectInstall("/nowhere/special")).toBe("checkout");
  });
});
