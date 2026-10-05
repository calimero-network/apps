/**
 * The data source on a DELEGATED (account) session: contract calls go through
 * the session's `mero.rpc` (the relay), and PRIVATE events never reach the
 * contract — a relay has no private storage for the accounts it serves, so
 * they live in the device-local store, keyed by account + team. The node path
 * is unchanged: private events go to the contract's private methods.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const CTX = "c0".repeat(32);
const NS = "a1".repeat(32);
const ME = "e".repeat(64);
const PEER = "f".repeat(64);

vi.mock("@calimero-network/mero-react", () => ({ getContextId: () => CTX }));
vi.mock("../identity", () => ({ accountId: () => ME }));

import { ClientApiDataSource } from "./ClientApiDataSource";
import { privateStoreKey } from "../privateStore";
import type { DataSession } from "../session";
import type { IEventCreate } from "../../types/event";

const execute = vi.fn();
const rpc = { execute } as unknown as NonNullable<DataSession["rpc"]>;

function source(isDelegated: boolean) {
  return new ClientApiDataSource(() => ({ rpc, isDelegated, namespaceId: NS }));
}

const draft = (overrides: Partial<IEventCreate> = {}): IEventCreate => ({
  title: "Standup",
  description: "",
  start: "2026-10-05T09:00:00.000Z",
  end: "2026-10-05T09:15:00.000Z",
  peers: [PEER],
  type: "event",
  color: "#000",
  owner: ME,
  private: false,
  ...overrides,
});

beforeEach(() => {
  execute.mockReset();
  localStorage.clear();
});

describe("on an account", () => {
  it("writes a shared event through the session transport", async () => {
    execute.mockResolvedValue("ev-1");
    const res = await source(true).createEvent(draft());
    expect(res.data).toBe("ev-1");
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ contextId: CTX, method: "create_event" }),
    );
  });

  it("keeps a PRIVATE event on this device and sends nothing to the contract", async () => {
    const res = await source(true).createEvent(draft({ private: true, peers: [] }));
    expect(typeof res.data).toBe("string");
    expect(execute).not.toHaveBeenCalled();
    const stored = JSON.parse(localStorage.getItem(privateStoreKey(ME, NS)) ?? "[]");
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ id: res.data, contextId: CTX, owner: ME, private: true });
  });

  it("keeps a PEERLESS event on this device too: the contract would make it private", async () => {
    // `create_event` with no peers goes to `#[app::private]` inside the
    // contract, which on a relay is the storage an account does not have.
    const res = await source(true).createEvent(draft({ private: false, peers: [] }));
    expect(execute).not.toHaveBeenCalled();
    expect(localStorage.getItem(privateStoreKey(ME, NS))).toContain(String(res.data));
  });

  it("reads private events from this device and shared ones from the contract", async () => {
    execute.mockResolvedValue([
      { id: "shared-1", title: "Shared", description: "", start: "s", end: "e", event_type: "event", color: "", owner: ME, peers: [PEER] },
    ]);
    const ds = source(true);
    const created = await ds.createEvent(draft({ private: true, peers: [] }));
    const res = await ds.getEvents();
    const ids = (res.data ?? []).map((e) => e.id);
    expect(ids).toEqual(["shared-1", created.data]);
    expect(res.data?.find((e) => e.id === created.data)?.private).toBe(true);
    // Only `get_events` was asked of the contract — never `get_private_events`.
    const methods = execute.mock.calls.map((c) => (c[0] as { method: string }).method);
    expect(methods).toEqual(["get_events"]);
  });

  it("updates and deletes a private event on this device", async () => {
    const ds = source(true);
    const { data: id } = await ds.createEvent(draft({ private: true, peers: [] }));
    const upd = await ds.updateEvent(id as string, { title: "Renamed", private: true });
    expect(upd.data).toBe(id);
    expect(localStorage.getItem(privateStoreKey(ME, NS))).toContain("Renamed");
    const del = await ds.deleteEvent(id as string, true);
    expect(del.data).toBe(id);
    expect(JSON.parse(localStorage.getItem(privateStoreKey(ME, NS)) ?? "[]")).toEqual([]);
    expect(execute).not.toHaveBeenCalled();
  });

  it("keeps one account's private events apart from another's on the same browser", async () => {
    await source(true).createEvent(draft({ private: true, peers: [] }));
    expect(localStorage.getItem(privateStoreKey("other", NS))).toBeNull();
    expect(localStorage.getItem(privateStoreKey(ME, "other-team"))).toBeNull();
  });
});

describe("on a node (unchanged)", () => {
  it("sends a private event to the contract's private method", async () => {
    execute.mockResolvedValue("ev-p");
    const res = await source(false).createEvent(draft({ private: true, peers: [] }));
    expect(res.data).toBe("ev-p");
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ method: "create_private_event" }),
    );
    expect(localStorage.length).toBe(0);
  });

  it("reads both event sets from the contract", async () => {
    execute.mockResolvedValue([]);
    await source(false).getEvents();
    const methods = execute.mock.calls.map((c) => (c[0] as { method: string }).method);
    expect(methods.sort()).toEqual(["get_events", "get_private_events"]);
  });
});
