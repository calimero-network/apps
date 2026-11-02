import { AppError, type CalimeroClient } from "@calimero-network/mero-js";
import { afterEach, describe, expect, it, vi } from "vitest";

import { bindApi } from "./client";
import {
  createBoard,
  createTeam,
  getBlob,
  listBoards,
  listGroupMembers,
  listTeams,
  rpcCall,
  uploadBlob,
} from "./rpc";

function bind(client: Partial<Record<keyof CalimeroClient, unknown>>) {
  const after = vi.fn();
  bindApi({
    client: client as unknown as CalimeroClient,
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
    const after = bind({ call, view });
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
      .mockResolvedValueOnce({ index: 1, result: { items: [el("a"), el("b")], next: "c1" } })
      .mockResolvedValueOnce({ index: 1, result: { items: [{ ...el("c"), x: "-5", updatedAt: "9" }], next: null } });
    bind({ view });
    const els = await rpcCall<Array<{ id: string; x?: number; updatedAt?: number }>>("board-1", "get_elements", {});
    expect(els.map((e) => e.id)).toEqual(["a", "b", "c"]);
    expect(els[2]).toMatchObject({ x: -5, updatedAt: 9 });
    expect(view).toHaveBeenNthCalledWith(1, "board-1", "getElements", { cursor: null, limit: 1000 });
    expect(view).toHaveBeenNthCalledWith(2, "board-1", "getElements", { cursor: "c1", limit: 1000 });
  });

  it("reads every comment page", async () => {
    const view = vi
      .fn()
      .mockResolvedValueOnce({ index: 1, result: { items: [{ id: "c1", replies: [] }], next: "n" } })
      .mockResolvedValueOnce({ index: 1, result: { items: [{ id: "c2", replies: [] }], next: null } });
    bind({ view });
    const comments = await rpcCall<Array<{ id: string }>>("board-1", "get_comments", {});
    expect(comments.map((c) => c.id)).toEqual(["c1", "c2"]);
    expect(view).toHaveBeenNthCalledWith(2, "board-1", "getComments", { cursor: "n", limit: 100 });
  });

  it("runs a chunked clear until nothing is left", async () => {
    const call = vi
      .fn()
      .mockResolvedValueOnce({ index: 1, result: "1200", events: [] })
      .mockResolvedValueOnce({ index: 2, result: "200", events: [] })
      .mockResolvedValueOnce({ index: 3, result: "0", events: [] });
    bind({ call });
    expect(await rpcCall("board-1", "clear_elements", {})).toBeNull();
    expect(call).toHaveBeenCalledTimes(3);
    expect(call).toHaveBeenCalledWith("board-1", "clearElements", {});
  });

  it("sends an element's 64-bit fields as strings", async () => {
    const call = vi.fn().mockResolvedValue({ index: 1, result: "e1", events: [] });
    bind({ call });
    await rpcCall("board-1", "add_element", {
      element: { id: "e1", data: { kind: "rect" }, x: 3, y: -4, createdAt: 5, updatedAt: 6, label: null },
    });
    expect(call.mock.calls[0]![2]).toEqual({
      element: { id: "e1", data: { kind: "rect" }, x: "3", y: "-4", createdAt: "5", updatedAt: "6", label: null },
    });
  });

  it("throws the contract's own message", async () => {
    const refusal = new AppError("app error", {
      code: "Forbidden",
      fields: { message: "view-only: editor or admin access is required to modify this board" },
    });
    bind({ call: vi.fn().mockRejectedValue(refusal) });
    await expect(rpcCall("board-1", "delete_element", { id: "e" })).rejects.toThrow(/^view-only/);
  });
});

describe("teams and boards", () => {
  it("lists the account's organizations as teams", async () => {
    bind({ me: vi.fn().mockResolvedValue({ orgs: [{ orgId: "org-1", name: "Design", role: "member" }] }) });
    expect(await listTeams()).toEqual([{ namespaceId: "org-1", name: "Design", role: "member" }]);
  });

  it("creates a team whose members may create boards and invite", async () => {
    const createOrg = vi.fn().mockResolvedValue("org-9");
    const setCapabilities = vi.fn().mockResolvedValue(undefined);
    bind({ createOrg, setCapabilities });
    expect(await createTeam("Design")).toEqual({ namespaceId: "org-9" });
    expect(setCapabilities).toHaveBeenCalledWith("org-9", expect.any(Number), expect.anything());
  });

  it("keeps the team when members could not be given the defaults, and says so", async () => {
    bind({ createOrg: vi.fn().mockResolvedValue("org-9"), setCapabilities: vi.fn().mockRejectedValue(new Error("no")) });
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
    bind({ createApp, call });
    expect(await createBoard("org-1", "Landing")).toBe("board-9");
    expect(createApp).toHaveBeenCalledWith("Landing", "bundle-hash", { org: "org-1" });
    expect(call).toHaveBeenCalledWith("board-9", "updateBoard", { name: "Landing", description: "" });
  });

  it("reads the team's members with the two roles the screens show", async () => {
    bind({
      getOrg: vi.fn().mockResolvedValue({
        name: "Design",
        members: { a: "owner", b: "admin", c: "member", d: "guest" },
        memberMetadata: { c: { name: "Cy" } },
      }),
    });
    expect((await listGroupMembers("org-1")).members).toEqual([
      { identity: "a", role: "Admin", owner: true },
      { identity: "b", role: "Admin" },
      { identity: "c", role: "Member", name: "Cy" },
      { identity: "d", role: "Member" },
    ]);
  });
});

describe("blobs", () => {
  const image = (blobId: string) => ({
    id: "img", data: { kind: "image", naturalWidth: 1, naturalHeight: 1, blobId },
    x: 0, y: 0, createdAt: 1, updatedAt: 1, label: null,
  });

  it("an image whose blob the board holds is added as it is", async () => {
    const call = vi.fn().mockResolvedValue({ index: 1, result: "img", events: [] });
    const upload = vi.fn().mockResolvedValue({ id: "11".repeat(32) });
    bind({ call, uploadBlob: upload });
    await uploadBlob(new Uint8Array([1]), "board-h");
    await rpcCall("board-h", "add_element", { element: image("11".repeat(32)) });
    expect((call.mock.calls[0]![2] as { element: { data: { blobId?: string } } }).element.data.blobId)
      .toBe("11".repeat(32));
  });

  it("an image from elsewhere whose bytes cannot be found is added without its blob", async () => {
    const call = vi.fn().mockResolvedValue({ index: 1, result: "img", events: [] });
    const download = vi.fn().mockRejectedValue(new Error("not found"));
    bind({ call, downloadBlob: download });
    const element = image("22".repeat(32));
    await rpcCall("board-x", "add_elements", { elements: [element] });
    const sent = (call.mock.calls[0]![2] as { elements: Array<{ data: Record<string, unknown> }> }).elements;
    expect(sent[0]!.data).not.toHaveProperty("blobId");
    expect(element.data.blobId).toBe("22".repeat(32)); // the caller's element is untouched
  });

  it("an image the board already holds, though unseen, keeps its blob", async () => {
    const call = vi.fn().mockResolvedValue({ index: 1, result: "img", events: [] });
    const download = vi.fn().mockResolvedValue(new Uint8Array([3]));
    bind({ call, downloadBlob: download });
    await rpcCall("board-y", "add_element", { element: image("33".repeat(32)) });
    expect(download).toHaveBeenCalledWith("board-y", "33".repeat(32));
    expect((call.mock.calls[0]![2] as { element: { data: { blobId?: string } } }).element.data.blobId)
      .toBe("33".repeat(32));
  });

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
