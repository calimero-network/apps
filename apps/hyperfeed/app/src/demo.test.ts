import { describe, expect, it, vi } from "vitest";
import { DemoBackend, NO_ASK } from "./demo";
import { send } from "./useFeed";
import { replySubject, subjectKey } from "./subject";
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
    grant: "",
    subject: "",
    send_call: "",
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

describe("allow for this session", () => {
  const SESSION = "Allow for this session";
  const allowed = async (b: DemoBackend, app: string, answer: string) => {
    const p = await b.recordAction(action(app, "proposed", { ask: ask("choose", ["Allow once", SESSION]) }));
    return b.resolveAction(p.id, "approve", answer);
  };

  it("records what runs under it without a breach", async () => {
    const b = fresh();
    const grant = await allowed(b, "mero-bot", SESSION);
    const ran = await b.recordAction(action("mero-bot", "done", { grant: grant.id }));
    expect(ran).toMatchObject({ breach: "", needs_you: false });
    expect((await b.recordAction(action("mero-bot", "done"))).breach).toMatch(/acted without asking/);
  });

  it("does not count in another app, for Allow once, or past a pause or a guard", async () => {
    const b = fresh();
    const grant = await allowed(b, "mero-bot", SESSION);
    const once = await allowed(b, "mero-bot", "Allow once");
    expect((await b.recordAction(action("chat", "done", { grant: grant.id }))).breach).not.toBe("");
    expect((await b.recordAction(action("mero-bot", "done", { grant: once.id }))).breach).not.toBe("");
    expect((await b.recordAction(action("mero-bot", "done", { grant: grant.id, category: "delete" }))).breach).toMatch(/always needs you/);
    await b.setPaused(true);
    expect((await b.recordAction(action("mero-bot", "done", { grant: grant.id }))).breach).toMatch(/paused/);
    await expect(b.recordAction(action("mero-bot", "proposed", { grant: grant.id }))).rejects.toThrow(/grant/);
  });

  it("lasts 12 hours", async () => {
    let now = 1_000_000;
    const b = new DemoBackend(false, 0, () => now);
    const grant = await allowed(b, "mero-bot", SESSION);
    now += 12 * 60 * 60_000 + 1_000;
    expect((await b.recordAction(action("mero-bot", "done", { grant: grant.id }))).breach).toMatch(/acted without asking/);
  });
});

describe("a chain still underway", () => {
  it("is led by what is still running, not by a newer step that is done", async () => {
    vi.useFakeTimers();
    const b = new DemoBackend(false, 1_000);
    await b.setPolicy("sheets", "act", "feed");
    const p = await b.recordAction(action("chat", "proposed"));
    await b.resolveAction(p.id, "approve");
    const later = await b.recordAction(action("sheets", "done", { chain: p.chain }));
    expect((await b.feed("all", "")).items[0]).toMatchObject({ id: p.id, status: "approved", needs_you: false });
    // The pretend agent reports it done.
    await vi.advanceTimersByTimeAsync(1_000);
    vi.useRealTimers();
    expect((await b.feed("all", "")).items[0]!.id).toBe(later.id);
  });

  it("is led by your message until it is answered, and by your answer until it is delivered", async () => {
    const b = fresh();
    await b.setPolicy("sheets", "act", "feed");
    const q = await b.say("", "Pull the numbers");
    await b.recordAction(action("sheets", "done", { chain: q.chain }));
    expect((await b.feed("all", "")).items[0]!.id).toBe(q.id);

    const n = await b.recordNotification(note("m", "chat", { ask: ask("reply", ["On it"]) }));
    await b.answerNotification(n.id, "On it");
    await b.recordAction(action("sheets", "done", { chain: n.chain }));
    const row = (await b.feed("all", "")).items.find((i) => i.chain === n.chain);
    expect(row).toMatchObject({ id: n.id, status: "answered" });
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


describe("stale questions", () => {
  const choose = (...options: string[]) => ({ kind: "choose", prompt: "", options, draft: "" });

  it("replaces your agent's open question with its newer one, as the contract does", async () => {
    const b = new DemoBackend(false, 0);
    const q = await b.say("", "Tidy up #launch");
    const first = b.agentAsk(q.chain, q.id, "Delete the duplicate?", choose("Delete", "Keep"));
    const second = b.agentAsk(q.chain, "", "Archive the channel?", choose("Archive", "Leave it"));
    const chain = await b.chain(q.chain);
    expect(chain.find((i) => i.id === first.id)).toMatchObject({ status: "asked", needs_you: false, superseded_by: second.id });
    expect(chain.find((i) => i.id === second.id)).toMatchObject({ needs_you: true, superseded_by: "" });
    // A plain answer goes to the question in front of you.
    await b.say(q.chain, "Archive");
    const after = await b.chain(q.chain);
    expect(after.find((i) => i.id === second.id)!.status).toBe("answered");
    expect(after.find((i) => i.id === first.id)!.status).toBe("asked");
  });

  it("flags an answer that still reaches a replaced question", async () => {
    const b = new DemoBackend(false, 0);
    const q = await b.say("", "Tidy up #launch");
    const first = b.agentAsk(q.chain, q.id, "Delete the duplicate?", choose("Delete", "Keep"));
    const second = b.agentAsk(q.chain, "", "Archive the channel?", choose("Archive", "Leave it"));
    const late = await b.answerAsk(first.id, q.chain, "Delete");
    expect(late).toMatchObject({ from: "you", answers: first.id, answers_superseded: true });
    const chain = await b.chain(q.chain);
    expect(chain.find((i) => i.id === second.id)).toMatchObject({ status: "asked", needs_you: true });
    await expect(b.answerAsk(first.id, q.chain, "Keep")).rejects.toThrow(/already answered/);
  });
});

describe("one thread per task", () => {
  const comment = (issue: string, key: string): NotificationInput => ({
    key, app: "issue-tracker", source_context: "repo", source_label: "", from: "Xabi", title: "Commented on your issue",
    body: "", event: "CommentAdded", needs_you: false, chain: "", ask: NO_ASK,
    item_type: "message", fields: "{}", reply_call: JSON.stringify({ method: "add_comment", args: { issue_id: issue, body: "=answer" } }),
  });
  const task = (b: DemoBackend, key: string) =>
    b.recordNotification({
      key, app: "mero-bot", source_context: "", source_label: "", from: "", title: "Task", body: "", event: "Prompt",
      needs_you: false, chain: "", ask: NO_ASK, item_type: "", fields: "", reply_call: "",
    });

  it("joins a comment to the chain whose write touched the same issue, as the contract does", async () => {
    const b = fresh();
    await b.setPolicy("issue-tracker", "act", "feed");
    const t = await task(b, "mero-bot:t");
    await b.recordAction(action("issue-tracker", "done", { source_context: "repo", chain: t.chain, subject: subjectKey("issue-tracker", "repo", "issue-7") }));
    const joined = await b.recordNotification(comment("issue-7", "repo:a>b:0"));
    expect(joined).toMatchObject({ chain: t.chain, subject: "issue-tracker:repo:issue-7" });
    const other = await b.recordNotification(comment("issue-8", "repo:b>c:0"));
    expect(other.chain).toBe(other.id);
    await b.archive([t.chain], 0);
    const later = await b.recordNotification(comment("issue-7", "repo:c>d:0"));
    expect(later.chain).toBe(later.id);
  });

  it("links what the task touches, and a link you take off stays off, as the contract does", async () => {
    const b = fresh();
    await b.setPolicy("issue-tracker", "act", "feed");
    const t = await task(b, "mero-bot:links");
    const subject = subjectKey("issue-tracker", "repo", "issue-7");
    await b.recordAction(action("issue-tracker", "done", { source_context: "repo", chain: t.chain, subject }));
    await b.recordNotification(comment("issue-7", "repo:l>m:0"));
    expect((await b.links(t.chain)).map((l) => [l.subject, l.by, l.activity])).toEqual([[subject, "agent", 1]]);
    await b.removeLink(t.chain, subject);
    await b.recordAction(action("issue-tracker", "done", { source_context: "repo", chain: t.chain, subject }));
    expect(await b.links(t.chain)).toEqual([]);
    const later = await b.recordNotification(comment("issue-7", "repo:m>n:0"));
    expect(later.chain).toBe(later.id);
    await b.addLink(t.chain, subject, "Sync bug");
    expect((await b.links(t.chain)).map((l) => [l.label, l.by])).toEqual([["Sync bug", "you"]]);
  });

  it("keys subjects as the contract does", () => {
    expect(subjectKey("chat", "ctx", "")).toBe("chat:ctx");
    expect(subjectKey("chat", "", "x")).toBe("");
    expect(replySubject("issue-tracker", "ctx", JSON.stringify({ method: "add_comment", args: { issue_id: "i-1" } }))).toBe("issue-tracker:ctx:i-1");
    expect(replySubject("chat", "ctx", JSON.stringify({ method: "send_message", args: { message: "=answer" } }))).toBe("chat:ctx");
    expect(replySubject("chat", "ctx", "")).toBe("");
  });
});

describe("drafts you send, and agent accounts", () => {
  const draft = (extra: Partial<ActionInput> = {}) =>
    action("chat", "proposed", {
      title: "Reply to Maya",
      ask: { kind: "reply", prompt: "Send this?", options: [], draft: "Numbers are in the sheet." },
      send_call: JSON.stringify({ method: "send_message", args: { message: "=answer" } }),
      ...extra,
    });

  it("approving a draft sends it as you, with your edit, and reports it", async () => {
    const b = fresh();
    await b.setPolicy("chat", "read", "feed");
    const item = await b.recordAction(draft());
    expect(item.reply_call).toContain("send_message");
    expect(item.undoable).toBe(false);
    const approved = await b.resolveAction(item.id, "approve", "Sent you the numbers.");
    await send(b, approved, "Sent you the numbers.");
    expect(b.sent.at(-1)).toEqual({ contextId: "ctx", method: "send_message", args: { message: "Sent you the numbers." } });
    expect((await b.chain(item.chain)).at(-1)?.status).toBe("done");
  });

  it("a refused send goes back to you as failed", async () => {
    const b = fresh();
    const item = await b.recordAction(draft());
    const approved = await b.resolveAction(item.id, "approve", "Numbers are in the sheet.");
    vi.spyOn(b, "callApp").mockRejectedValueOnce(new Error("you are not in this channel"));
    await expect(send(b, approved, "Numbers are in the sheet.")).rejects.toThrow("not in this channel");
    expect((await b.chain(item.chain)).at(-1)?.status).toBe("failed");
  });

  it("refuses a send call that is not a call, or not on a proposal", async () => {
    const b = fresh();
    await expect(b.recordAction(draft({ send_call: "not json" }))).rejects.toThrow("not JSON");
    await expect(b.recordAction(draft({ send_call: '{"args":{}}' }))).rejects.toThrow("names no method");
    await expect(b.recordAction(draft({ outcome: "done", ask: NO_ASK }))).rejects.toThrow("belongs on a proposal");
  });

  it("adds and removes agent accounts, one name each", async () => {
    const b = fresh();
    await b.addAgentAccount("acc-1", "cloud");
    await expect(b.addAgentAccount("acc-2", "cloud")).rejects.toThrow("already the name");
    expect((await b.settings()).agent_accounts).toEqual([expect.objectContaining({ account: "acc-1", name: "cloud" })]);
    await b.removeAgentAccount("acc-1");
    expect((await b.settings()).agent_accounts).toEqual([]);
  });
});

describe("DemoBackend follows approved actions, as the contract does", () => {
  const def = (id: string, label: string, category: string, writes: boolean, methods: string[]) => ({
    id, label, description: "", category, writes, methods,
  });
  const chat = [
    def("read", "Read messages", "", false, ["get_messages", "search"]),
    def("send", "Send messages", "", true, ["send_message", "reply"]),
    def("edit", "Edit your messages", "", true, ["edit_message"]),
    def("delete", "Delete your messages", "delete", true, ["delete_message"]),
  ];
  const approved = async (b: DemoBackend, version = "app-1", actions = chat) => {
    await b.proposeActions("chat", version, actions, "Chat");
    await b.decideActions("chat", version, "approve");
  };

  it("lets approved actions decide what a call is", async () => {
    const b = fresh();
    await b.setPolicy("chat", "act", "feed");
    expect(b.verdict("chat", "", true, "delete_message").decision).toBe("act");
    await b.proposeActions("chat", "app-1", chat, "Chat");
    expect(b.verdict("chat", "", true, "delete_message").decision).toBe("act");
    await b.decideActions("chat", "app-1", "approve");
    expect(b.verdict("chat", "", true, "delete_message").reason).toContain('"delete"');
    expect(b.verdict("chat", "new_contact", true, "send_message").decision).toBe("ask");
    expect(b.verdict("chat", "", true, "send_message").decision).toBe("act");
    expect(b.verdict("chat", "", true, "search").decision).toBe("act");
    expect(b.verdict("chat", "", false, "drop_channel").reason).toContain("isn't one of chat's actions");
    expect(b.verdict("chat", "", true).decision).toBe("act");

    const undescribed = await b.recordAction(action("chat", "done", { method: "drop_channel" }));
    expect(undescribed.breach).toMatch(/^acted without asking/);
    const deleted = await b.recordAction(action("chat", "done", { method: "delete_message" }));
    expect(deleted.category).toBe("delete");
  });

  it("sets each action apart from its app, under the guards", async () => {
    const b = fresh();
    await approved(b);
    await b.setActionMode("chat", "edit", "act");
    expect(b.verdict("chat", "", true, "edit_message").reason).toContain("Edit your messages");
    expect(b.verdict("chat", "", true, "send_message").decision).toBe("ask");
    await b.setActionMode("chat", "delete", "act");
    expect(b.verdict("chat", "", true, "delete_message").decision).toBe("ask");
    await b.setActionMode("chat", "send", "off");
    await expect(b.recordAction(action("chat", "proposed"))).rejects.toThrow(/you turned off/);
    await b.setActionMode("chat", "send", "");
    expect((await b.settings()).action_modes).toEqual([
      { app: "chat", action: "delete", mode: "act" },
      { app: "chat", action: "edit", mode: "act" },
    ]);
  });

  it("keeps the newest approved actions in force while new ones wait", async () => {
    const b = fresh();
    await b.setPolicy("chat", "act", "feed");
    await approved(b);
    await b.proposeActions("chat", "app-2", chat.slice(0, 3), "v2");
    expect(b.verdict("chat", "", true, "delete_message").reason).toContain('"delete"');
    await b.decideActions("chat", "app-2", "approve");
    expect(b.verdict("chat", "", true, "delete_message").reason).toContain("isn't one of chat's actions");
    expect((await b.actionSets()).map((s) => s.application_id)).toEqual(["app-2", "app-1"]);
  });

  it("holds a session grant to one action", async () => {
    const b = fresh();
    await approved(b);
    const proposal = await b.recordAction(action("chat", "proposed", { ask: ask("choose", ["Allow once", "Allow for this session"]) }));
    await b.resolveAction(proposal.id, "approve", "Allow for this session");
    const reply = await b.recordAction(action("chat", "done", { method: "reply", grant: proposal.id }));
    expect(reply.breach).toBe("");
    const edit = await b.recordAction(action("chat", "done", { method: "edit_message", grant: proposal.id }));
    expect(edit.breach).not.toBe("");
  });
});

describe("DemoBackend lets a guard cover reads, as the contract does", () => {
  it("asks before reading a secret once that guard is on", async () => {
    const b = fresh();
    await b.setPolicy("pass", "act", "feed");
    expect(b.verdict("pass", "secret", false).decision).toBe("act");
    await b.setGuard("secret", true);
    expect(b.verdict("pass", "secret", false).reason).toContain('"secret"');
    expect(b.verdict("pass", "", false).decision).toBe("act");
  });
});
