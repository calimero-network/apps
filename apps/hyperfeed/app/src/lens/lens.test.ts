import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { Deferred, ExprError, evaluate, identifiers, parse } from "./expr";
import { fillReplyCall, parseLens, runLens, type LensHost, type LensSpec } from "./lens";
import { validateLens, type Abi } from "./validate";

const APPS = path.resolve(__dirname, "../../../..");
const abiOf = (app: string) => JSON.parse(readFileSync(path.join(APPS, app, "logic/res/abi.json"), "utf8")) as Abi;
const fixture = (name: string) => parseLens(readFileSync(path.join(__dirname, "fixtures", `${name}.json`), "utf8"));

const ME = new Set(["me-b58", "me-hex"]);
const scope = (vars: Record<string, unknown> = {}) => ({ vars, me: ME });

describe("expressions", () => {
  it("read paths, indexes and missing values without throwing", () => {
    const vars = { page: { messages: [{ text: "hi", tags: ["a"] }] } };
    expect(evaluate("page.messages[0].text", scope(vars))).toBe("hi");
    expect(evaluate("page.messages[0].tags.length", scope(vars))).toBe(1);
    expect(evaluate("page.nothing.deeper[3]", scope(vars))).toBeNull();
    expect(evaluate("page.messages.length", scope(vars))).toBe(1);
  });

  it("know who you are", () => {
    expect(evaluate("has(m, me)", scope({ m: ["x", "me-hex"] }))).toBe(true);
    expect(evaluate("has(m, me)", scope({ m: ["x"] }))).toBe(false);
    expect(evaluate("has(m, 'everyone')", scope({ m: ["everyone"] }))).toBe(true);
    expect(evaluate("mine(a) || mine(b)", scope({ a: "x", b: "me-b58" }))).toBe(true);
  });

  it("join, choose and compare", () => {
    expect(evaluate("t == 'Dm' ? 'DM' : '#' + n", scope({ t: "Channel", n: "launch" }))).toBe("#launch");
    expect(evaluate("'a\\nb'", scope())).toBe("a\nb");
    expect(evaluate("plain('<p>a &amp; b</p>')", scope())).toBe("a & b");
    expect(evaluate("join(['a', 'b'], ' / ') + str(3)", scope())).toBe("a / b3");
    expect(evaluate("len(x) >= 2 && !false", scope({ x: [1, 2] }))).toBe(true);
  });

  it("cannot do anything but read", () => {
    for (const bad of ["a = 1", "fetch('x')", "a; b", "constructor.constructor('x')()", "`x`", "a.b(", "x =>"]) {
      expect(() => parse(bad), bad).toThrow(ExprError);
    }
    // Reading through the prototype finds nothing.
    expect(evaluate("x.constructor", scope({ x: {} }))).toBeNull();
    expect(evaluate("x['__proto__']", scope({ x: {} }))).toBeNull();
  });

  it("leave the answer for later", () => {
    expect(() => evaluate("answer", { ...scope(), deferred: new Set(["answer"]) })).toThrow(Deferred);
    expect(identifiers("item.sender + answer")).toEqual(["item", "answer"]);
  });
});

/** mero-chat as the lens sees it, answering the methods it calls. */
function chatHost(messages: Record<string, unknown>[], { dm = false } = {}): LensHost & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    me: async () => ME,
    name: async (id) => (id === "maya" ? "Maya" : ""),
    call: async <T,>(method: string, args: Record<string, unknown>) => {
      calls.push(method);
      const answer = (() => {
        switch (method) {
          case "message_position": {
            const i = messages.findIndex((m) => m.id === args.message_id);
            return i < 0 ? null : i;
          }
          case "get_messages_from":
            return { messages: messages.slice(args.start as number, (args.start as number) + 1) };
          case "get_info":
            return { name: "launch", context_type: dm ? "Dm" : "Channel" };
          case "get_member_role":
            return "Mod";
        }
        throw new Error(`no method ${method}`);
      })();
      return answer as T;
    },
  };
}

const msg = (id: string, sender: string, text: string, extra: Record<string, unknown> = {}) => ({
  id,
  sender,
  text,
  mentions: [],
  mentions_usernames: [],
  deleted: null,
  ...extra,
});
const SOURCE = { contextId: "ctx-chat", appKey: "chat", label: "chat · ctx-ch" };

describe("the Chat lens", () => {
  const lens = fixture("chat");

  it("is valid against mero-chat's ABI", () => {
    expect(validateLens(lens, abiOf("mero-chat"))).toEqual([]);
  });

  it("makes a mention a message you can reply to", async () => {
    const host = chatHost([msg("m1", "maya", "<p>Can you pull the <b>numbers</b>?</p>", { mentions: ["me-b58"] })]);
    const out = await runLens(lens, "MessageSent", { message_id: "m1" }, SOURCE, host);
    expect(out.kind).toBe("recorded");
    if (out.kind !== "recorded") return;
    expect(out.reading).toMatchObject({
      item_type: "message",
      title: "Mentioned you",
      from: "Maya",
      body: "Can you pull the numbers?",
      source_label: "#launch",
      needs_you: true,
      ask: { kind: "reply", prompt: "Reply in #launch" },
    });
    expect(JSON.parse(out.reading.fields)).toMatchObject({ from: "Maya", from_id: "maya", is_dm: false });
    // The reply call keeps your answer and the time for later.
    expect(JSON.parse(out.reading.reply_call)).toMatchObject({
      method: "send_message",
      args: { message: "=answer", timestamp: "=now_s()", mentions: [], parent_message: null },
    });
    const filled = fillReplyCall(out.reading.reply_call, "On it", 1_700_000_000_000);
    expect(filled).toEqual({
      method: "send_message",
      args: { message: "On it", mentions: [], mentions_usernames: [], parent_message: null, timestamp: 1_700_000_000, files: null, images: null },
    });
  });

  it("makes a DM a message, and skips the rest of a channel and your own", async () => {
    const dm = await runLens(lens, "MessageSent", { message_id: "m1" }, SOURCE, chatHost([msg("m1", "maya", "hi")], { dm: true }));
    expect(dm.kind === "recorded" && dm.reading.title).toBe("Sent you a message");
    const chatter = await runLens(lens, "MessageSent", { message_id: "m1" }, SOURCE, chatHost([msg("m1", "maya", "lunch?")]));
    expect(chatter).toEqual({ kind: "skipped", why: "not for you" });
    const own = await runLens(lens, "MessageSent", { message_id: "m1" }, SOURCE, chatHost([msg("m1", "me-b58", "@me", { mentions: ["me-b58"] })]));
    expect(own.kind).toBe("skipped");
  });

  it("ignores bookkeeping without reading anything", async () => {
    const host = chatHost([]);
    expect((await runLens(lens, "MessageEdited", "m1", SOURCE, host)).kind).toBe("skipped");
    expect((await runLens(lens, "CursorMoved", "x", SOURCE, host)).kind).toBe("skipped");
    expect(host.calls).toEqual([]);
  });

  it("tells you when your role changes, and nobody else's", async () => {
    const mine = await runLens(lens, "RoleUpdated", "me-b58", SOURCE, chatHost([]));
    expect(mine.kind === "recorded" && mine.reading).toMatchObject({ item_type: "status", body: "You are now Mod in #launch", needs_you: false });
    expect((await runLens(lens, "RoleUpdated", "maya", SOURCE, chatHost([]))).kind).toBe("skipped");
  });

  it("drops an event whose reads fail, and says why", async () => {
    const host = { ...chatHost([]), call: async () => Promise.reject(new Error("method not found")) };
    expect(await runLens(lens, "MessageSent", { message_id: "m1" }, SOURCE, host)).toEqual({ kind: "error", why: "method not found" });
  });
});

describe("other apps' lenses", () => {
  it("Vote: a poll open to you, with its options; no answer from the feed", () => {
    const lens = fixture("vote");
    expect(validateLens(lens, abiOf("mero-vote"))).toEqual([]);
  });

  it("Vote: a ballot is something the feed cannot cast", () => {
    const lens = fixture("vote");
    const open = lens.events.VotingOpened as Exclude<LensSpec["events"][string], "ignore">;
    const withVote: LensSpec = {
      ...lens,
      events: { ...lens.events, VotingOpened: { ...open, reply: { method: "cast_ballot", args: { poll_id: "=answer", ballot: { choice: "=answer" } } } } },
    };
    const problems = validateLens(withVote, abiOf("mero-vote"));
    expect(problems.some((p) => p.includes("ballot is a WireBallot the lens cannot build"))).toBe(true);
  });

  it("Updates: a question for the team, answered with a comment", () => {
    expect(validateLens(fixture("updates"), abiOf("mero-updates"))).toEqual([]);
  });
});

describe("validation", () => {
  const abi = abiOf("mero-chat");
  const base = (patch: Record<string, unknown>): LensSpec =>
    ({ version: 1, events: { MessageSent: { type: "message", fields: {}, ...patch } } }) as LensSpec;

  it("names every problem, one line each", () => {
    const cases: [LensSpec, string][] = [
      [{ version: 1, events: { Nope: "ignore" } }, "emits no event Nope"],
      [base({ read: [{ as: "x", call: "send_message", args: {} }] }), "a lens may only read"],
      [base({ read: [{ as: "x", call: "get_messages_from", args: { begin: 1 } }] }), "takes no argument begin"],
      [base({ read: [{ as: "x", call: "get_messages_from", args: {} }] }), "needs start"],
      [base({ read: [{ as: "event", call: "get_info", args: {} }] }), "reserved name"],
      [base({ fields: { colour: "red" } }), "a message has no field colour"],
      [base({ fields: { text: "=nobody.text" } }), "unknown name nobody"],
      [base({ fields: { text: "=answer" } }), "exist only in reply args"],
      [base({ show_if: "=a ==" }), "show_if"],
      [base({ type: "tweet" }), "type must be one of"],
      [base({ reply: { method: "get_info", args: {} } }), "a reply must change something"],
      [base({ reply: { method: "send_message", args: { message: "hi", mentions: [], mentions_usernames: [], timestamp: "=now_s()" } } }), "never use answer"],
      [base({ reply: { method: "send_message", args: { message: "=answer + event.x", mentions: [], mentions_usernames: [], timestamp: 1 } } }), "reads nothing else"],
      [base({ reply: { method: "send_message", args: { message: "=answer", mentions: [], mentions_usernames: [], timestamp: "now" } } }), "timestamp is a number"],
      [base({ ask: { kind: "reply" } }), "nothing to answer with"],
      [base({ fields: { text: "=event.body" } }), "event has no field body (it has message_id)"],
      [
        base({ read: [{ as: "page", call: "get_messages_from", args: { start: 0 } }], let: { item: "=page.messages[0]" }, fields: { text: "=item.content" } }),
        "item has no field content",
      ],
    ];
    for (const [spec, expected] of cases) {
      const problems = validateLens(spec, abi);
      expect(problems.join("\n"), expected).toContain(expected);
    }
  });
});
