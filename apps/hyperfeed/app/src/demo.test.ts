import { describe, expect, it } from "vitest";
import { DemoBackend, NO_ASK } from "./demo";
import type { ActionInput, Ask, NotificationInput } from "./generated/HyperfeedClient";

// The demo stands in for the contract, so it is held to the cases
// `logic/src/tests.rs` asserts.

function fresh() {
  return new DemoBackend(false, 0);
}

function action(app: string, outcome: string, extra: Partial<ActionInput> = {}): ActionInput {
  return {
    app,
    source_context: "ctx",
    source_label: "#launch",
    method: "send_message",
    category: "",
    writes: true,
    undoable: true,
    title: "Posted your stand-up",
    body: "",
    why: "",
    outcome,
    intent_hash: "",
    executor: "",
    note: "",
    chain: "",
    ask: NO_ASK,
    ...extra,
  };
}

function note(key: string, app: string, extra: Partial<NotificationInput> = {}): NotificationInput {
  return {
    key,
    app,
    source_context: "",
    source_label: "",
    from: "",
    title: "Poll",
    body: "",
    event: "",
    needs_you: false,
    chain: "",
    ask: NO_ASK,
    item_type: "",
    fields: "",
    reply_call: "",
    ...extra,
  };
}

const ask = (kind: string, options: string[] = [], draft = ""): Ask => ({ kind, prompt: "", options, draft });

describe("DemoBackend follows the contract's rules", () => {
  it("asks first in an app with no policy", () => {
    expect(fresh().verdict("chat", "", true).decision).toBe("ask");
  });

  it("turns act into ask for a guarded category", async () => {
    const b = fresh();
    await b.setPolicy("sign", "act", "feed");
    expect(b.verdict("sign", "sign", true).decision).toBe("ask");
    await b.setGuard("sign", false);
    expect(b.verdict("sign", "sign", true).decision).toBe("act");
  });

  it("records acting without asking as a breach until kept", async () => {
    const b = fresh();
    const item = await b.recordAction(action("chat", "done"));
    expect(item.breach).toMatch(/^acted without asking/);
    expect(item.needs_you).toBe(true);
    const kept = await b.resolveAction(item.id, "keep");
    expect(kept.needs_you).toBe(false);
    expect(kept.reviewed_at).toBeGreaterThan(0);
  });

  it("refuses a proposal where the agent is off", async () => {
    const b = fresh();
    await b.setPolicy("crm", "off", "feed");
    await expect(b.recordAction(action("crm", "proposed"))).rejects.toThrow(/off in crm/);
  });

  it("keeps every step in the history", async () => {
    const b = fresh();
    const p = await b.recordAction(action("chat", "proposed"));
    const approved = await b.resolveAction(p.id, "approve");
    expect(approved.history.map((s) => s.status)).toEqual(["pending", "approved"]);
    await b.setPolicy("chat", "act", "feed");
    const fixed = await b.recordAction(action("chat", "done", { undoable: false }));
    await expect(b.resolveAction(fixed.id, "undo")).rejects.toThrow(/cannot undo/);
  });

  it("records a notification once per key and hides muted apps", async () => {
    const b = fresh();
    await b.recordNotification(note("k1", "vote", { needs_you: true }));
    await b.recordNotification(note("k1", "vote", { needs_you: true }));
    expect((await b.feed("all", "")).counts.all).toBe(1);
    expect((await b.feed("needs_you", "")).items).toHaveLength(1);
    await b.setPolicy("vote", "off", "mute");
    expect((await b.feed("all", "")).counts.all).toBe(0);
  });
});

describe("chains", () => {
  it("shows one row per chain, led by what needs you", async () => {
    const b = fresh();
    await b.setPolicy("sheets", "act", "feed");
    const mention = await b.recordNotification(note("m", "chat", { needs_you: true }));
    await b.recordAction(action("sheets", "done", { chain: mention.id }));
    const nda = await b.recordAction(action("sign", "proposed", { category: "sign", chain: mention.id }));
    const page = await b.feed("all", "");
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({ id: nda.id, chain: mention.id, chain_len: 3, needs_you: true });
    const flow = await b.chain(mention.id);
    expect(flow.map((i) => i.kind)).toEqual(["notification", "action", "action"]);
  });

  it("filters chains by what they hold", async () => {
    const b = fresh();
    await b.setPolicy("sheets", "act", "feed");
    const mention = await b.recordNotification(note("m", "chat"));
    await b.recordAction(action("sheets", "done", { chain: mention.id }));
    expect((await b.feed("agent", "")).items).toHaveLength(1);
    expect((await b.feed("all", "chat")).items).toHaveLength(1);
    expect((await b.feed("needs_you", "")).items).toHaveLength(0);
  });
});

describe("answers", () => {
  it("answers a reply in place; the agent delivers it", async () => {
    const b = fresh();
    const n = await b.recordNotification(note("m", "chat", { ask: ask("reply", ["On it"]) }));
    expect(n.needs_you).toBe(true);
    await b.markSeen([n.id]);
    expect((await b.chain(n.chain))[0]!.needs_you).toBe(true);
    await expect(b.answerNotification(n.id, " ")).rejects.toThrow(/empty/);
    const answered = await b.answerNotification(n.id, "Numbers are in the deck.");
    expect(answered).toMatchObject({ status: "answered", note: "Numbers are in the deck.", needs_you: false });
    await expect(b.answerNotification(n.id, "again")).rejects.toThrow(/already answered/);
  });

  it("checks a choice against its options", async () => {
    const b = fresh();
    const n = await b.recordNotification(note("v", "vote", { ask: ask("choose", ["Lisbon", "Berlin"]) }));
    await expect(b.answerNotification(n.id, "Paris")).rejects.toThrow(/one of/);
    expect((await b.answerNotification(n.id, "Lisbon")).note).toBe("Lisbon");
  });

  it("approves a proposal with the option picked", async () => {
    const b = fresh();
    const p = await b.recordAction(action("calendar", "proposed", { ask: ask("choose", ["Thu", "Fri"]) }));
    await expect(b.resolveAction(p.id, "approve")).rejects.toThrow(/one of/);
    expect((await b.resolveAction(p.id, "approve", "Fri")).note).toBe("Fri");
  });

  it("refuses an ask on an outcome, and an answer on a notification without one", async () => {
    const b = fresh();
    await expect(b.recordAction(action("chat", "done", { ask: ask("confirm") }))).rejects.toThrow(/proposal/);
    const n = await b.recordNotification(note("k", "kv"));
    await expect(b.answerNotification(n.id, "")).rejects.toThrow(/nothing to answer/);
  });

  it("seeds a morning with every kind of ask", async () => {
    const page = await new DemoBackend(true, 0).feed("all", "");
    const kinds = new Set(page.items.map((i) => i.ask.kind));
    expect(kinds).toEqual(new Set(["", "reply", "choose"]));
    expect(page.items.some((i) => i.chain_len > 1)).toBe(true);
    expect(page.counts.needs_you).toBeGreaterThan(0);
  });

  describe("talking to your agent", () => {
    it("starts a chain of its own when asked from nowhere, and counts as agent activity", async () => {
      const b = fresh();
      const q = await b.say("", "What's on my plate today?");
      expect(q).toMatchObject({ kind: "message", from: "you", status: "waiting", chain: q.id, needs_you: false, app: "" });
      const page = await b.feed("agent", "");
      expect(page.items.map((i) => i.id)).toEqual([q.id]);
      expect(page.apps).toEqual([]);
    });

    it("joins an existing chain, and refuses one that does not exist", async () => {
      const b = fresh();
      const a = await b.recordAction(action("chat", "done"));
      const q = await b.say(a.chain, "Why did you post that?");
      expect(q.chain).toBe(a.chain);
      expect(await b.chain(a.chain)).toHaveLength(2);
      await expect(b.say("nope", "hi")).rejects.toThrow(/no chain/);
      await expect(b.say("", "  ")).rejects.toThrow(/empty/);
    });

    it("takes a message up, answers it, and marks it answered", async () => {
      const b = fresh();
      const q = await b.say("", "Book lunch with Maya");
      expect(b.agentAck(q.id).status).toBe("thinking");
      expect(() => b.agentAck(q.id)).toThrow(/cannot mark it thinking/);
      const answer = b.agentSay(q.chain, q.id, "Proposed two slots below.");
      expect(answer).toMatchObject({ from: "agent", status: "said", reply_to: q.id, chain: q.chain });
      expect((await b.chain(q.chain)).find((i) => i.id === q.id)?.status).toBe("answered");
      expect(() => b.agentAck(answer.id)).toThrow(/agent's own/);
      expect(() => b.agentSay("elsewhere", q.id, "x")).toThrow(/is in chain/);
    });

    it("lets the agent give up on a message it took up", async () => {
      const b = fresh();
      const q = await b.say("", "Cancel my 3pm");
      b.agentAck(q.id);
      expect(b.agentAck(q.id, "failed", "No calendar access").status).toBe("failed");
    });

    it("has the pretend agent answer on its own", async () => {
      const b = new DemoBackend(false, 5);
      const q = await b.say("", "hello");
      await new Promise((r) => setTimeout(r, 40));
      const chain = await b.chain(q.chain);
      expect(chain.map((i) => [i.from, i.status])).toEqual([
        ["you", "answered"],
        ["agent", "said"],
      ]);
    });
  });

  describe("typed rows and lenses", () => {
    const REPLY = JSON.stringify({ method: "send_message", args: { message: "=answer" } });

    it("keeps a typed row's type, fields and reply call", async () => {
      const b = fresh();
      const n = await b.recordNotification(note("t", "chat", { item_type: "message", fields: '{"from":"Maya"}', reply_call: REPLY, ask: ask("reply") }));
      expect(n).toMatchObject({ item_type: "message", fields: '{"from":"Maya"}', reply_call: REPLY });
      await expect(b.recordNotification(note("u", "chat", { item_type: "tweet" }))).rejects.toThrow(/item_type/);
    });

    it("reports a direct answer delivered or failed, only after you answered", async () => {
      const b = fresh();
      const n = await b.recordNotification(note("t", "chat", { item_type: "message", reply_call: REPLY, ask: ask("reply") }));
      await expect(b.completeAnswer(n.id, "delivered", "")).rejects.toThrow(/nothing is waiting/);
      await b.answerNotification(n.id, "hi");
      expect((await b.completeAnswer(n.id, "failed", "banned")).status).toBe("failed");
    });

    it("approves and turns down lenses", async () => {
      const b = new DemoBackend(true, 0);
      const before = await b.lenses();
      expect(before.map((l) => [l.app, l.status])).toEqual([
        ["vote", "proposed"],
        ["chat", "approved"],
      ]);
      expect((await b.decideLens("vote", "demo-vote", "approve")).status).toBe("approved");
      await expect(b.decideLens("vote", "nope", "approve")).rejects.toThrow(/no lens/);
    });
  });
});

