import { describe, expect, it } from "vitest";

import {
  messagePermalink,
  parseMessagePermalink,
  resolveMessageLink,
} from "./permalink";

const CTX = "FgEXVaJojT3MAnL5orPPJQhxjDV1YzbLdC35QdWUxwvm";
const MID = "2f4809296e76ed16cdc0b196b4a1d334c20895ac93a2d0b5ad144c766e2bf4b2_1787600001";

describe("message permalinks", () => {
  it("round-trips a link", () => {
    const link = { contextId: CTX, index: 117, messageId: MID };
    expect(
      parseMessagePermalink(messagePermalink(link, "https://chat.example")),
    ).toEqual(link);
  });

  it("carries an id so the position can be checked", () => {
    // The position finds a message; the id proves it is the right one. Without
    // it a stale link opens a DIFFERENT message and nothing looks wrong.
    const url = messagePermalink(
      { contextId: CTX, index: 42, messageId: MID },
      "https://chat.example",
    );

    expect(url).toBe(`https://chat.example/?context-id=${CTX}&m=42&mid=${MID}`);
  });

  it("discloses nothing but a channel, a position and a digest", () => {
    const url = messagePermalink(
      { contextId: CTX, index: 42, messageId: MID },
      "https://chat.example",
    );

    // Safe only because ids are digests now; while they were the plaintext
    // hex-encoded, this link would have carried the message itself.
    expect(url).not.toMatch(/merger|secret|hello/i);
  });

  it("refuses a link with no id rather than opening an unverifiable message", () => {
    // An unverifiable message link is not a message link. Returning null means
    // the app opens the channel normally instead of guessing.
    expect(parseMessagePermalink(`?context-id=${CTX}&m=7`)).toBeNull();
    expect(parseMessagePermalink(`?context-id=${CTX}&m=7&mid=`)).toBeNull();
    expect(parseMessagePermalink(`?context-id=${CTX}&m=7&mid=%20`)).toBeNull();
  });

  it("reads a link from a bare query string", () => {
    expect(parseMessagePermalink(`?context-id=${CTX}&m=7&mid=${MID}`)).toEqual({
      contextId: CTX,
      index: 7,
      messageId: MID,
    });
  });

  it("treats index 0 as a real position", () => {
    // The first message in a channel is linkable like any other; a falsy check
    // on the index would drop it.
    expect(parseMessagePermalink(`?context-id=${CTX}&m=0&mid=${MID}`)).toEqual({
      contextId: CTX,
      index: 0,
      messageId: MID,
    });
  });

  it("refuses a malformed position rather than opening the wrong place", () => {
    // Coercing these to 0 would open the top of the channel and look like the
    // link worked.
    for (const bad of ["-1", "1.5", "abc", "1e3", " ", ""]) {
      expect(
        parseMessagePermalink(`?context-id=${CTX}&m=${bad}&mid=${MID}`),
      ).toBeNull();
    }
  });

  it("is not a message link when the channel is missing", () => {
    expect(parseMessagePermalink(`?m=5&mid=${MID}`)).toBeNull();
    expect(parseMessagePermalink("https://chat.example/")).toBeNull();
  });

  it("ignores unrelated parameters the app also uses", () => {
    expect(
      parseMessagePermalink(
        `?node_url=http://localhost:3428&context-id=${CTX}&m=3&mid=${MID}`,
      ),
    ).toEqual({ contextId: CTX, index: 3, messageId: MID });
  });
});

describe("resolveMessageLink — the message, or an error, never another message", () => {
  const msg = (index: number, id: string) => ({ index, id, text: `m${index}` });
  const link = { index: 40, messageId: "the-linked-id" };

  it("finds the message when the position still holds it", () => {
    const result = resolveMessageLink(
      [msg(39, "a"), msg(40, "the-linked-id"), msg(41, "c")],
      link,
    );

    expect(result.status).toBe("found");
    expect(result.status === "found" && result.message.id).toBe("the-linked-id");
  });

  it("REFUSES a different message sitting at that position", () => {
    // The failure this whole mechanism exists to prevent. Without the id this
    // returns a perfectly real message and the reader cannot tell it is wrong.
    const result = resolveMessageLink(
      [msg(39, "a"), msg(40, "somebody-elses-message"), msg(41, "c")],
      link,
    );

    expect(result.status).toBe("mismatch");
    expect(result.status === "mismatch" && result.found.id).toBe(
      "somebody-elses-message",
    );
  });

  it("reports a position the channel does not hold", () => {
    expect(resolveMessageLink([msg(1, "a"), msg(2, "b")], link).status).toBe(
      "missing",
    );
  });

  it("does not match on position alone when ids differ by one character", () => {
    const result = resolveMessageLink([msg(40, "the-linked-i")], link);
    expect(result.status).toBe("mismatch");
  });

  it("is unmoved by the right message sitting at the wrong position", () => {
    // A shifted channel: the message exists, but not where the link says. That
    // is still not a resolution — the link named a position, and honouring it
    // from elsewhere would mean guessing.
    const result = resolveMessageLink(
      [msg(37, "the-linked-id"), msg(40, "different")],
      link,
    );
    expect(result.status).toBe("mismatch");
  });

  it("treats an empty window as missing rather than throwing", () => {
    expect(resolveMessageLink([], link).status).toBe("missing");
  });
});
