import type { AppInfo } from "@calimero-network/mero-js";
import { describe, expect, it, vi } from "vitest";

import {
  channelAppName,
  createChannel,
  dmAppName,
  listConversations,
  listMembers,
  listWorkspaces,
  openDm,
  parseConversation,
  setPrivateMember,
  type Conversation,
} from "./workspace";

const app = (name: string, org: string | null = "org-1", owner = "me"): AppInfo => ({
  appId: `id-${name}`,
  name,
  owner,
  org,
  bundle: "b",
  package: null,
  version: null,
});

describe("conversations are named by kind", () => {
  it("reads a channel, a private channel and a DM back from the app name", () => {
    expect(parseConversation(app(channelAppName("general", false)), "me")).toMatchObject({ kind: "channel", name: "general" });
    expect(parseConversation(app(channelAppName("design", true)), "me")).toMatchObject({ kind: "private", name: "design" });
    const dm = parseConversation(app(dmAppName("me", "bob")), "me");
    expect(dm).toMatchObject({ kind: "dm", name: "bob", accounts: ["bob", "me"] });
    expect(dmAppName("bob", "me")).toBe(dmAppName("me", "bob"));
  });

  it("ignores instances outside an org or not named by this app", () => {
    expect(parseConversation(app("#general", null), "me")).toBeNull();
    expect(parseConversation(app("e2e-123"), "me")).toBeNull();
  });

  it("lists one workspace's conversations, of the dev bundle or the package", async () => {
    const listApps = vi.fn().mockResolvedValue([app("#b"), app("#a"), app("#x", "org-2"), app("dm:bob:me")]);
    const list = await listConversations({ listApps }, "bundle-hash", "org-1", "me");
    expect(listApps).toHaveBeenCalledWith({ bundle: "bundle-hash" });
    expect(list.map((c) => c.name)).toEqual(["a", "b", "bob"]);
    await listConversations({ listApps }, { package: "com.calimero.chat" }, "org-1", "me");
    expect(listApps).toHaveBeenLastCalledWith({ package: "com.calimero.chat" });
  });
});

describe("creating conversations", () => {
  it("creates a public channel with org access and its init arguments", async () => {
    const createApp = vi.fn().mockResolvedValue("app-1");
    await createChannel({ createApp }, "bundle", "org-1", "general", false, "Alice");
    expect(createApp).toHaveBeenCalledWith("#general", "bundle", {
      org: "org-1",
      access: { kind: "org" },
      initArgs: { name: "general", contextType: "Channel", description: "", creatorUsername: "Alice" },
    });
  });

  it("creates a private channel reaching only its creator", async () => {
    const createApp = vi.fn().mockResolvedValue("app-2");
    await createChannel({ createApp }, "bundle", "org-1", "design", true, "Alice");
    expect(createApp.mock.calls[0][2].access).toEqual({ kind: "accounts", accounts: [] });
  });

  it("opens an existing DM instead of creating a second one, and refuses a DM with oneself", async () => {
    const createApp = vi.fn().mockResolvedValue("dm-new");
    const existing: Conversation[] = [{ appId: "dm-1", org: "org-1", owner: "bob", kind: "dm", name: "bob", accounts: ["bob", "me"] }];
    expect(await openDm({ createApp }, "bundle", existing, "org-1", "me", "bob", "Me")).toBe("dm-1");
    expect(createApp).not.toHaveBeenCalled();
    expect(await openDm({ createApp }, "bundle", existing, "org-1", "me", "carol", "Me")).toBe("dm-new");
    expect(createApp).toHaveBeenCalledWith("dm:carol:me", "bundle", {
      org: "org-1",
      access: { kind: "accounts", accounts: ["carol"] },
      initArgs: { name: "", contextType: "Dm", description: "", creatorUsername: "Me" },
    });
    await expect(openDm({ createApp }, "bundle", existing, "org-1", "me", "me", "Me")).rejects.toThrow();
  });

  it("adds and removes a private channel's member through its access", async () => {
    const getApp = vi.fn().mockResolvedValue({ access: { kind: "accounts", accounts: ["bob"] } });
    const setAccess = vi.fn().mockResolvedValue(undefined);
    await setPrivateMember({ getApp, setAccess }, "app-1", "carol", true);
    expect(setAccess).toHaveBeenLastCalledWith("app-1", { kind: "accounts", accounts: ["bob", "carol"] });
    await setPrivateMember({ getApp, setAccess }, "app-1", "bob", false);
    expect(setAccess).toHaveBeenLastCalledWith("app-1", { kind: "accounts", accounts: [] });
  });
});

describe("the workspace's org", () => {
  it("lists the workspaces the account is in, by name", async () => {
    const me = vi.fn().mockResolvedValue({
      orgs: [
        { orgId: "o2", name: "Zeta", role: "member" },
        { orgId: "o1", name: "Acme", role: "owner" },
      ],
    });
    expect(await listWorkspaces({ me })).toEqual([
      { orgId: "o1", name: "Acme", role: "owner" },
      { orgId: "o2", name: "Zeta", role: "member" },
    ]);
  });

  it("lists members with the names they gave the workspace", async () => {
    const getOrg = vi.fn().mockResolvedValue({
      members: { "acc-a": "owner", "acc-b": "member" },
      memberMetadata: { "acc-b": { name: "Bob" } },
    });
    expect(await listMembers({ getOrg }, "o1")).toEqual([
      { account: "acc-a", role: "owner", name: "" },
      { account: "acc-b", role: "member", name: "Bob" },
    ]);
  });
});
