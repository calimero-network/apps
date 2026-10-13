import { describe, expect, it, vi } from "vitest";
import { runJoin } from "./JoinPage";

const link = { namespaceId: "1".repeat(64), invitation: {} as never };
const profile = { displayName: "Ana", handle: "ana" };

describe("runJoin", () => {
  it("joins, finds the org context, claims and reports the member", async () => {
    const join = vi.fn(async () => ({ ok: true as const }));
    const listGroupContexts = vi.fn(async () => [{ contextId: "ctx1" }]);
    const claim = vi.fn(async () => ({ account: "a".repeat(64), status: "enrolled" }));
    const out = await runJoin(link, profile, { join, listGroupContexts, claim });
    expect(out).toEqual({ ok: true, contextId: "ctx1", account: "a".repeat(64) });
    expect(claim).toHaveBeenCalledWith("ctx1", "Ana", "ana");
  });

  it("stops on a final join failure and says why", async () => {
    const join = vi.fn(async () => ({ ok: false as const, step: "admit" as const, reason: "The admitter refused the join. expired", final: true }));
    const out = await runJoin(link, profile, { join, listGroupContexts: vi.fn(), claim: vi.fn() });
    expect(out).toEqual({ ok: false, final: true, reason: "The admitter refused the join. expired" });
  });

  it("treats a namespace with no org context yet as retryable", async () => {
    const out = await runJoin(link, profile, { join: vi.fn(async () => ({ ok: true as const })), listGroupContexts: vi.fn(async () => []), claim: vi.fn() });
    expect(out).toEqual({ ok: false, final: false, reason: "The org has no context yet; wait a moment and retry, or ask the admin." });
  });

  it("a retry after the join succeeded does not join again", async () => {
    const join = vi.fn(async () => ({ ok: true as const }));
    const claim = vi.fn(async () => ({ account: "a".repeat(64), status: "enrolled" }));
    let joined = false;
    const failing = { join, listGroupContexts: vi.fn(async (): Promise<{ contextId: string }[]> => { throw new Error("relay not caught up"); }), claim };
    await expect(runJoin(link, profile, failing, { onJoined: () => { joined = true; } })).rejects.toThrow("relay not caught up");
    expect(join).toHaveBeenCalledTimes(1);
    expect(joined).toBe(true);
    const out = await runJoin(link, profile, { join, listGroupContexts: vi.fn(async () => [{ contextId: "ctx1" }]), claim }, { alreadyJoined: joined });
    expect(join).toHaveBeenCalledTimes(1);
    expect(out).toEqual({ ok: true, contextId: "ctx1", account: "a".repeat(64) });
  });

  it("an already-member claim is not an error: the person is in", async () => {
    const claim = vi.fn(async () => { throw new Error("this account is already a member"); });
    const out = await runJoin(link, profile, { join: vi.fn(async () => ({ ok: true as const })), listGroupContexts: vi.fn(async () => [{ contextId: "ctx1" }]), claim });
    expect(out).toEqual({ ok: true, contextId: "ctx1", account: "" });
  });
});
