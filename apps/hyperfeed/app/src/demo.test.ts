import { describe, expect, it } from "vitest";
import { DemoBackend } from "./demo";
import type { ActionInput } from "./generated/HyperfeedClient";

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
    ...extra,
  };
}

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
  });

  it("refuses a proposal where the agent is off", async () => {
    const b = fresh();
    await b.setPolicy("crm", "off", "feed");
    await expect(b.recordAction(action("crm", "proposed"))).rejects.toThrow(/off in crm/);
  });

  it("moves a proposal through approve, and refuses an undo of something fixed", async () => {
    const b = fresh();
    const p = await b.recordAction(action("chat", "proposed"));
    expect(p.status).toBe("pending");
    expect((await b.resolveAction(p.id, "approve")).status).toBe("approved");
    await b.setPolicy("chat", "act", "feed");
    const fixed = await b.recordAction(action("chat", "done", { undoable: false }));
    await expect(b.resolveAction(fixed.id, "undo")).rejects.toThrow(/cannot undo/);
  });

  it("records a notification once per key and hides muted apps", async () => {
    const b = fresh();
    const n = { key: "k1", app: "vote", source_context: "", source_label: "", from: "", title: "Poll", body: "", event: "", needs_you: true };
    await b.recordNotification(n);
    await b.recordNotification(n);
    expect((await b.feed("all", "")).counts.all).toBe(1);
    expect((await b.feed("needs_you", "")).items).toHaveLength(1);
    await b.setPolicy("vote", "off", "mute");
    expect((await b.feed("all", "")).counts.all).toBe(0);
  });

  it("seeds the morning the design shows", async () => {
    const page = await new DemoBackend(true, 0).feed("all", "");
    expect(page.counts.agent).toBeGreaterThan(0);
    expect(page.counts.notifications).toBeGreaterThan(0);
    expect(page.counts.needs_you).toBeGreaterThan(0);
  });
});
