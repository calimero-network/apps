import { describe, expect, it, vi } from "vitest";
import { DEFAULT_ORG_CAPABILITIES, ORG_CAPABILITIES } from "@calimero-network/mero-js";
import type { KeyValueStorage } from "@calimero-apps/connect";
import {
  MEMBER_DEFAULTS,
  captureInvite,
  createRoom,
  createStream,
  setMembersCreateRooms,
  dropInvite,
  inviteLink,
  listRooms,
  listStreams,
  migrateLegacyInvite,
  pendingInvite,
  streamInfo,
} from "./streams";

class Memory implements KeyValueStorage {
  readonly items = new Map<string, string>();
  getItem(k: string) {
    return this.items.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.items.set(k, v);
  }
  removeItem(k: string) {
    this.items.delete(k);
  }
}

const app = (appId: string, name: string, org: string | null) => ({
  appId,
  name,
  org,
  owner: "acct",
  bundle: "b",
  package: null,
  version: null,
});

describe("streams are organizations, rooms are app instances", () => {
  it("lists the account's orgs with their room and member counts", async () => {
    const client = {
      me: vi.fn(async () => ({
        orgs: [
          { orgId: "o2", name: "Zeta", role: "Member" },
          { orgId: "o1", name: "Alpha", role: "Owner" },
        ],
      })),
      listApps: vi.fn(async () => [app("a", "Room", "o1"), app("b", "Other", "o1"), app("c", "X", null)]),
      getOrg: vi.fn(async (org: string) =>
        org === "o1" ? { members: { acct: "owner", bob: "member" } } : Promise.reject(new Error("x")),
      ),
    };
    const rows = await listStreams(client as never, "bundle-hash");
    expect(client.listApps).toHaveBeenCalledWith({ bundle: "bundle-hash" });
    expect(rows).toEqual([
      { orgId: "o1", name: "Alpha", role: "owner", roomCount: 2, memberCount: 2 },
      { orgId: "o2", name: "Zeta", role: "member", roomCount: 0, memberCount: 0 },
    ]);
  });

  it("lists one stream's rooms, by name, from the package in production", async () => {
    const client = {
      listApps: vi.fn(async () => [app("b", "Beta", "o1"), app("a", "Alpha", "o1"), app("c", "Gamma", "o2")]),
    };
    const rooms = await listRooms(client, { package: "com.calimero.mero-stream" }, "o1");
    expect(client.listApps).toHaveBeenCalledWith({ package: "com.calimero.mero-stream" });
    expect(rooms.map((r) => r.name)).toEqual(["Alpha", "Beta"]);
  });

  it("creates a room in the org, naming the stream in init", async () => {
    const client = { createApp: vi.fn(async () => "app-1") };
    expect(await createRoom(client, "bundle", "o1", "Standup")).toBe("app-1");
    expect(client.createApp).toHaveBeenCalledWith("Standup", "bundle", {
      org: "o1",
      initArgs: { name: "Standup" },
    });
  });

  it("reads member display names from org member metadata", async () => {
    const client = {
      getOrg: vi.fn(async () => ({
        name: "Team",
        members: { a: "owner", b: "member" },
        memberMetadata: { a: { name: " Alice " }, b: { title: "x" } },
      })),
    };
    expect(await streamInfo(client as never, "o1")).toEqual({
      name: "Team",
      members: ["a", "b"],
      names: { a: "Alice" },
      roles: { a: "owner", b: "member" },
      memberDefaults: DEFAULT_ORG_CAPABILITIES,
    });
  });
});

describe("members of a new stream may create rooms (core's CREATE_APP)", () => {
  it("member defaults are core's own plus CREATE_APP", () => {
    expect(MEMBER_DEFAULTS & ORG_CAPABILITIES.CREATE_APP).toBe(ORG_CAPABILITIES.CREATE_APP);
    expect(MEMBER_DEFAULTS & DEFAULT_ORG_CAPABILITIES).toBe(DEFAULT_ORG_CAPABILITIES);
  });

  it("creating a stream sets the org's member defaults, approved with the owner's passkey", async () => {
    const pk = { create: vi.fn(), get: vi.fn() };
    const client = {
      createOrg: vi.fn(async () => "o1"),
      setCapabilities: vi.fn(async () => {}),
    };
    expect(await createStream(client as never, "Team", () => pk as never)).toEqual({ orgId: "o1", warning: null });
    expect(client.createOrg).toHaveBeenCalledWith("Team");
    // No `at`: the organization's default, not one member's row.
    expect(client.setCapabilities).toHaveBeenCalledWith("o1", MEMBER_DEFAULTS, pk);
  });

  it("keeps the stream when the defaults are refused (a cancelled passkey), and says so", async () => {
    const client = {
      createOrg: vi.fn(async () => "o1"),
      setCapabilities: vi.fn(async () => Promise.reject(new Error("cancelled"))),
    };
    const created = await createStream(client as never, "Team", () => ({}) as never);
    expect(created.orgId).toBe("o1");
    expect(created.warning).toMatch(/Members can create rooms/);
  });

  it("the toggle flips only CREATE_APP in the org's default, keeping the other bits", async () => {
    const client = { setCapabilities: vi.fn(async () => {}) };
    const pk = {} as never;
    const others = ORG_CAPABILITIES.JOIN_OPEN_TEAMS | ORG_CAPABILITIES.INVITE_MEMBERS;
    await setMembersCreateRooms(client as never, "o1", others, true, pk);
    expect(client.setCapabilities).toHaveBeenLastCalledWith("o1", others | ORG_CAPABILITIES.CREATE_APP, pk);
    await setMembersCreateRooms(client as never, "o1", others | ORG_CAPABILITIES.CREATE_APP, false, pk);
    expect(client.setCapabilities).toHaveBeenLastCalledWith("o1", others, pk);
  });
});

describe("invitation links", () => {
  it("survive the sign-up: captured off the URL into the store, then dropped", () => {
    const link = inviteLink("tok", { stream: "o1", room: "app-1", name: "Standup" }, { href: "http://localhost:5173/streams/o1" });
    expect(new URL(link).pathname).toBe("/");
    window.history.replaceState(null, "", link.replace("http://localhost:5173", ""));
    captureInvite(window.location);
    expect(window.location.search).toBe("");
    expect(pendingInvite()).toEqual({ token: "tok", stream: "o1", room: "app-1", name: "Standup" });
    dropInvite();
    expect(pendingInvite()).toBeNull();
  });

  it("reads a link minted before the shared store, which named the stream as `stream`", () => {
    window.history.replaceState(null, "", "/?invite=tok&stream=o1&room=app-1");
    captureInvite(window.location);
    expect(pendingInvite()).toEqual({ token: "tok", stream: "o1", room: "app-1", name: null });
    dropInvite();
  });

  it("moves an invite an earlier build stored under its own key into the shared store", () => {
    const storage = new Memory();
    storage.setItem("mero-stream:pending-invite", JSON.stringify({ token: "old", stream: "o1", room: null, name: "Team" }));
    migrateLegacyInvite(storage);
    expect(pendingInvite()).toEqual({ token: "old", stream: "o1", room: null, name: "Team" });
    expect(storage.getItem("mero-stream:pending-invite")).toBeNull();
    dropInvite();
  });

  it("ignores a page opened without one", () => {
    window.history.replaceState(null, "", "/streams");
    captureInvite(window.location);
    expect(pendingInvite()).toBeNull();
  });
});
