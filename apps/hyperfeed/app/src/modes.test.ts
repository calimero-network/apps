import { describe, expect, it } from "vitest";
import type { FeedItem } from "./generated/HyperfeedClient";
import { chainMode, feedModes } from "./modes";

const msg = (from: string, mode: string) => ({ kind: "message", from, mode }) as FeedItem;

describe("message modes", () => {
  it("a chat keeps the mode of your last message that had one; Private when none did", () => {
    expect(chainMode([])).toBe("private");
    expect(chainMode([msg("you", "public"), msg("agent", "")])).toBe("public");
    expect(chainMode([msg("you", "public"), msg("you", "private")])).toBe("private");
    // A message without one does not change it.
    expect(chainMode([msg("you", "public"), msg("you", "")])).toBe("public");
  });

  it("a feed takes only the modes its settings list", () => {
    expect(feedModes(null)).toEqual([]);
    expect(feedModes({ message_modes: ["private", "public", "other"] } as never)).toEqual(["private", "public"]);
    // A feed made before modes lists none.
    expect(feedModes({} as never)).toEqual([]);
  });
});
