import { describe, expect, it } from "vitest";
import { generalChannel, landInGeneral, landed, wantsGeneral } from "./landing";

const ch = (alias: string, joined = true, identity = "acc") => ({
  contextId: `ctx-${alias}`,
  alias,
  info: null,
  isJoined: joined,
  contextIdentity: joined ? identity : undefined,
});

describe("landing in #general", () => {
  it("is asked for once and forgotten when done", () => {
    sessionStorage.clear();
    expect(wantsGeneral()).toBe(false);
    landInGeneral();
    expect(wantsGeneral()).toBe(true);
    landed();
    expect(wantsGeneral()).toBe(false);
  });

  it("picks #general once it is joined", () => {
    expect(generalChannel([ch("random"), ch("general", false)])).toBeUndefined();
    expect(generalChannel([ch("random"), ch("general")])?.contextId).toBe("ctx-general");
  });

  it("reads the channel's own name before its alias", () => {
    const c = { ...ch("x"), info: { name: "General" } as never };
    expect(generalChannel([c])?.contextId).toBe("ctx-x");
  });
});
