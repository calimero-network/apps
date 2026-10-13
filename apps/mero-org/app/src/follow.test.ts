import { describe, expect, it, vi } from "vitest";
import type { AppView, EnrolmentView } from "./backend";
import { appsToFollow, followApp } from "./follow";

const ME = "a".repeat(64);
const PEER = "/ip4/10.0.0.1/udp/2528/quic-v1/p2p/12D3KooWAdmin";
const app = (id: string, extra: Partial<AppView> = {}): AppView => ({
  id, package: "p", label: id, admin_account: "0".repeat(64), status: "ready", registered_at: 0, group_count: 1,
  application_id: "2".repeat(64), peer_addrs: [PEER], ...extra,
});
const row = (appId: string, state: string): EnrolmentView => ({ account: ME, app: appId, state, subgroups: [], note: "", updated_at: 0 });

describe("appsToFollow", () => {
  it("lists apps the account was added to that this node does not hold", () => {
    const apps = [app("drive"), app("chat"), app("held"), app("pending", { status: "pending_admin" })];
    const mine = [row("drive", "added"), row("chat", "placed"), row("held", "placed"), row("pending", "placed")];
    expect(appsToFollow(mine, apps, new Set(["held"])).map((t) => t.app.id)).toEqual(["drive", "chat"]);
  });

  it("leaves out failed and removed enrolments, and apps with no application recorded", () => {
    const apps = [app("failed"), app("removed"), app("bare", { application_id: "" })];
    const mine = [row("failed", "failed"), row("removed", "removed"), row("bare", "placed")];
    expect(appsToFollow(mine, apps, new Set())).toEqual([]);
  });
});

describe("followApp", () => {
  it("follows from the admin node's addresses with the namespace's application", async () => {
    const followNamespace = vi.fn(async () => ({ namespaceId: "drive", memberAccount: ME, keyReady: true }));
    expect(await followApp({ followNamespace }, app("drive"))).toEqual({ ok: true, keyReady: true });
    expect(followNamespace).toHaveBeenCalledWith("drive", { peerAddrs: [PEER], applicationId: "2".repeat(64) });
  });

  it("marks a 403 or 400 refusal final and anything else retryable", async () => {
    const refusing = (status: number) => ({ followNamespace: vi.fn(async () => { throw Object.assign(new Error(`refused ${status}`), { status }); }) });
    expect(await followApp(refusing(403), app("drive"))).toEqual({ ok: false, reason: "refused 403", final: true });
    expect(await followApp(refusing(400), app("drive"))).toEqual({ ok: false, reason: "refused 400", final: true });
    expect(await followApp(refusing(503), app("drive"))).toEqual({ ok: false, reason: "refused 503", final: false });
  });
});
