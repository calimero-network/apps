import { describe, expect, it, vi } from "vitest";
import type { KeyValueStorage } from "@calimero-apps/connect";
import {
  captureInvite,
  createRoom,
  dropInvite,
  inviteLink,
  listRooms,
  listStreams,
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
    });
  });
});

describe("invitation links", () => {
  it("survive the sign-up: captured off the URL into storage, then dropped", () => {
    const link = inviteLink(
      "tok",
      { stream: "o1", room: "app-1", name: "Standup" },
      { origin: "http://localhost:5173", pathname: "/" },
    );
    window.history.replaceState(null, "", link.replace("http://localhost:5173", ""));
    const storage = new Memory();
    captureInvite(storage, window.location);
    expect(window.location.search).toBe("");
    expect(pendingInvite(storage)).toEqual({
      token: "tok",
      stream: "o1",
      room: "app-1",
      name: "Standup",
    });
    dropInvite(storage);
    expect(pendingInvite(storage)).toBeNull();
  });

  it("ignores a page opened without one", () => {
    window.history.replaceState(null, "", "/streams");
    const storage = new Memory();
    captureInvite(storage, window.location);
    expect(pendingInvite(storage)).toBeNull();
  });
});
