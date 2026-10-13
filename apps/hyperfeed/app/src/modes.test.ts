import { describe, expect, it } from "vitest";
import type { FeedItem } from "./generated/HyperfeedClient";
import { chainMode, feedModes } from "./modes";

const msg = (from: string, mode: string) => ({ kind: "message", from, mode }) as FeedItem;

describe("message modes", () => {
  it("a chat keeps the mode of your last message that had one", () => {
    expect(chainMode([])).toBe("chat");
    expect(chainMode([msg("you", "code"), msg("agent", "")])).toBe("code");
    expect(chainMode([msg("you", "code"), msg("you", "chat")])).toBe("chat");
    // A message without one does not change it.
    expect(chainMode([msg("you", "code"), msg("you", "")])).toBe("code");
  });

  it("a feed takes only the modes its settings list", () => {
    expect(feedModes(null)).toEqual([]);
    expect(feedModes({ message_modes: ["chat", "code", "other"] } as never)).toEqual(["chat", "code"]);
    // A feed made before modes lists none.
    expect(feedModes({} as never)).toEqual([]);
  });
});
