import { AppError, type CalimeroClient } from "@calimero-network/mero-js";
import { afterEach, describe, expect, it, vi } from "vitest";

import { bindApi } from "./client";
import {
  createBoard,
  createTeam,
  getBlob,
  listBoards,
  listGroupMembers,
  listOtherTeams,
  listTeams,
  rpcCall,
  uploadBlob,
} from "./rpc";
import { withRoutes } from "@calimero-apps/connect/testing";

function bind(client: Partial<Record<keyof CalimeroClient, unknown>>) {
  const after = vi.fn();
  bindApi({
    client: withRoutes(client),
    accountId: "acct-me",
    source: "bundle-hash",
    passkey: () => ({ create: vi.fn(), get: vi.fn() }),
    after,
    scope: "local:acct-me",
  });
  return after;
}

afterEach(() => bindApi(null));

describe("rpcCall", () => {
  it("fails loudly before anyone is signed in", async () => {
    await expect(rpcCall("b", "get_board", {})).rejects.toThrow(/Not signed in/);
  });

  it("sends a call through the log and a view to a node, on the component's wire", async () => {
    const call = vi.fn().mockResolvedValue({ index: 2, result: "e1", events: [] });
    const view = vi.fn().mockResolvedValue({ index: 2, result: "admin" });
    const after = bind(withRoutes({ call, view }));
    await rpcCall("board-1", "set_layer_index", { id: "e1", index: 0, updated_at: 9 });
    expect(call).toHaveBeenCalledWith("board-1", "setLayerIndex", { id: "e1", index: 0, updatedAt: "9" });
    expect(await rpcCall("board-1", "my_role", {})).toBe("admin");
    expect(view).toHaveBeenCalledWith("board-1", "myRole", {});
    expect(after).toHaveBeenCalledTimes(2);
  });

  it("reads a board larger than a page whole, page by page", async () => {
    const el = (id: string) => ({ id, data: { kind: "rect" }, label: null });
    const view = vi
      .fn()
      .mockResolvedValueOnce({ index: 1, result: { items: [el("a"), el("b")], nextCursor: "c1" } })
      .mockResolvedValueOnce({ index: 1, result: { items: [el("c")], nextCursor: null } });
    bind({ view });
    const els = await rpcCall<Array<{ id: string }>>("board-1", "get_elements", {});
    expect(els.map((e) => e.id)).toEqual(["a", "b", "c"]);
    expect(view).toHaveBeenNthCalledWith(1, "board-1", "getElementsPage", { cursor: null, limit: 1000 });
    expect(view).toHaveBeenNthCalledWith(2, "board-1", "getElementsPage", { cursor: "c1", limit: 1000 });
  });

  it("throws the contract's own message", async () => {
    const refusal = new AppError("app error", {
      code: "Forbidden",
      fields: { message: "view-only: editor or admin access is required to modify this board" },
    });
    bind(withRoutes({ call: vi.fn().mockRejectedValue(refusal) }));
    await expect(rpcCall("board-1", "delete_element", { id: "e" })).rejects.toThrow(/^view-only/);
  });
});

describe("teams and boards", () => {
  it("lists the account's organizations holding boards as teams", async () => {
    bind(withRoutes({
      me: vi.fn().mockResolvedValue({ orgs: [{ orgId: "org-1", name: "Design", role: "member" }] }),
      listApps: vi.fn().mockResolvedValue([{ appId: "b1", name: "Board", owner: "x", org: "org-1", bundle: "bundle-hash" }]),
    }));
    expect(await listTeams()).toEqual([{ namespaceId: "org-1", name: "Design", role: "member" }]);
  });

  // The account of the bug: in `overworld`, which holds only a Mero Blocks world.
  it("leaves out an org made for another app, which only connecting offers", async () => {
    const blocks = { appId: "w1", name: "overworld", owner: "x", org: "ow", bundle: "blocks", package: "com.calimero.mero-blocks" };
    bind(withRoutes({
      me: vi.fn().mockResolvedValue({ orgs: [{ orgId: "ow", name: "overworld", role: "owner" }] }),
      listApps: vi.fn(async (f?: { bundle?: string }) => [blocks].filter((a) => !f?.bundle || a.bundle === f.bundle)),
      getOrg: vi.fn().mockResolvedValue({ members: { x: "owner" }, metadata: null }),
    }));
    expect(await listTeams()).toEqual([]);
    expect((await listOtherTeams()).map((o) => [o.orgId, o.label])).toEqual([["ow", "Mero Blocks: overworld"]]);
  });

  it("lists a team made here before it holds a board", async () => {
    bind(withRoutes({
      me: vi.fn().mockResolvedValue({ orgs: [{ orgId: "org-9", name: "New", role: "owner" }] }),
      listApps: vi.fn().mockResolvedValue([]),
      getOrg: vi.fn().mockResolvedValue({ members: {}, metadata: { createdFor: "bundle-hash" } }),
    }));
    expect(await listTeams()).toEqual([{ namespaceId: "org-9", name: "New", role: "owner" }]);
  });

  it("creates a team whose members may create boards and invite", async () => {
    const createOrg = vi.fn().mockResolvedValue("org-9");
    const setCapabilities = vi.fn().mockResolvedValue(undefined);
    bind(withRoutes({ createOrg, setCapabilities }));
    expect(await createTeam("Design")).toEqual({ namespaceId: "org-9" });
    expect(setCapabilities).toHaveBeenCalledWith("org-9", expect.any(Number), expect.anything());
  });

  it("keeps the team when members could not be given the defaults, and says so", async () => {
    bind(withRoutes({ createOrg: vi.fn().mockResolvedValue("org-9"), setCapabilities: vi.fn().mockRejectedValue(new Error("no")) }));
    const made = await createTeam("Design");
    expect(made.namespaceId).toBe("org-9");
    expect(made.warning).toMatch(/will not be able to create boards/);
  });

  it("lists a team's boards from this app's instances in its organization", async () => {
    const listApps = vi.fn().mockResolvedValue([
      { appId: "b2", name: "Zeta", owner: "o", org: "org-1" },
      { appId: "b1", name: "Alpha", owner: "o", org: "org-1" },
      { appId: "x", name: "Other", owner: "o", org: "org-2" },
    ]);
    bind({ listApps });
    expect((await listBoards("org-1")).map((b) => b.name)).toEqual(["Alpha", "Zeta"]);
    expect(listApps).toHaveBeenCalledWith({ bundle: "bundle-hash" });
  });

  it("creates a board in the team and names it on the contract", async () => {
    const createApp = vi.fn().mockResolvedValue("board-9");
    const call = vi.fn().mockResolvedValue({ index: 1, result: null, events: [] });
    bind(withRoutes({ createApp, call }));
    expect(await createBoard("org-1", "Landing")).toBe("board-9");
    expect(createApp).toHaveBeenCalledWith("Landing", "bundle-hash", { org: "org-1" });
    expect(call).toHaveBeenCalledWith("board-9", "updateBoard", { name: "Landing", description: "" });
  });

  it("reads the team's members with the two roles the screens show", async () => {
    bind(withRoutes({
      getOrg: vi.fn().mockResolvedValue({
        name: "Design",
        members: { a: "owner", b: "admin", c: "member", d: "guest" },
        memberMetadata: { c: { name: "Cy" } },
      }),
    }));
    expect((await listGroupMembers("org-1")).members).toEqual([
      { identity: "a", role: "Admin", owner: true },
      { identity: "b", role: "Admin" },
      { identity: "c", role: "Member", name: "Cy" },
      { identity: "d", role: "Member" },
    ]);
  });
});

describe("blobs", () => {
  it("uploads to the board's instance and keeps the hex id", async () => {
    const upload = vi.fn().mockResolvedValue({ blobId: "base58", id: "ab".repeat(32), size: 3 });
    bind({ uploadBlob: upload });
    expect(await uploadBlob(new Uint8Array([1, 2, 3]), "board-1")).toEqual({ blobId: "ab".repeat(32) });
    expect(upload).toHaveBeenCalledWith("board-1", new Uint8Array([1, 2, 3]));
    await expect(uploadBlob(new Uint8Array(), "")).rejects.toThrow(/board's id/);
  });

  it("downloads from the board's instance", async () => {
    const download = vi.fn().mockResolvedValue(new Uint8Array([7, 8]));
    bind({ downloadBlob: download });
    const buf = await getBlob("cd".repeat(32), "board-1");
    expect(new Uint8Array(buf)).toEqual(new Uint8Array([7, 8]));
    expect(download).toHaveBeenCalledWith("board-1", "cd".repeat(32));
  });
});
