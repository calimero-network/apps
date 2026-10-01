import { describe, expect, it, vi } from "vitest";

vi.mock("./selfIdentity", () => ({
  isSelfSender: (id: string) => id === "me",
}));

import { messageMentionsMe } from "./mentionsMe";

const CTX = "ctx-1";

describe("messageMentionsMe", () => {
  it("counts @everyone", () => {
    // The contract's own rule (get_unread_mentions): "Broadcast mentions
    // (@everyone / @here) always count." This mirrors it so the notification
    // agrees with the badge.
    expect(
      messageMentionsMe({ mentions_usernames: ["everyone"] }, CTX),
    ).toBe(true);
  });

  it("counts @here", () => {
    expect(messageMentionsMe({ mentions_usernames: ["here"] }, CTX)).toBe(true);
  });

  it("counts a direct mention of me", () => {
    expect(messageMentionsMe({ mentions: ["them", "me"] }, CTX)).toBe(true);
  });

  it("ignores a mention of somebody else", () => {
    expect(messageMentionsMe({ mentions: ["them"] }, CTX)).toBe(false);
  });

  it("ignores an ordinary message", () => {
    expect(messageMentionsMe({}, CTX)).toBe(false);
    expect(
      messageMentionsMe({ mentions: [], mentions_usernames: [] }, CTX),
    ).toBe(false);
  });

  it("does not treat a person named 'everyone' as a broadcast", () => {
    // `mentions_usernames` also carries ordinary names. Only the two reserved
    // words are broadcasts, and they are matched exactly — a member called
    // "Everyone Else" must not alert the channel.
    expect(
      messageMentionsMe({ mentions_usernames: ["Everyone Else"] }, CTX),
    ).toBe(false);
  });

  it("matches the reserved words case-insensitively", () => {
    // The composer inserts them lowercase, but a person can type them.
    expect(
      messageMentionsMe({ mentions_usernames: ["Everyone"] }, CTX),
    ).toBe(true);
    expect(messageMentionsMe({ mentions_usernames: ["HERE"] }, CTX)).toBe(true);
  });
});
