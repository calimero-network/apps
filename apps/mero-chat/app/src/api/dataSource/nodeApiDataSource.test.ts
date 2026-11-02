import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  createChatApp: vi.fn(),
  getAppRecord: vi.fn(),
  listChatApps: vi.fn(),
}));

vi.mock("../calimero", () => ({ getAccountId: () => "acct-me" }));
vi.mock("../platform", () => ({
  createChatApp: h.createChatApp,
  getAppRecord: h.getAppRecord,
  listChatApps: h.listChatApps,
  invalidate: () => {},
  run: vi.fn(),
}));

import { ContextApiDataSource } from "./nodeApiDataSource";

beforeEach(() => {
  for (const fn of Object.values(h)) fn.mockReset();
});

describe("ContextApiDataSource", () => {
  it("creates a channel's instance from the pending channel with v1's init params", async () => {
    h.createChatApp.mockResolvedValue("app-1");
    const res = await new ContextApiDataSource().createGroupContext({
      applicationId: "ignored",
      groupId: "pending:1",
      name: "general",
      initializationParams: { name: "general", context_type: "Channel" },
    });
    expect(h.createChatApp).toHaveBeenCalledWith("pending:1", "general", { name: "general", context_type: "Channel" });
    expect(res.data).toEqual({ contextId: "app-1", memberPublicKey: "acct-me" });
  });

  it("answers the account as the identity: there is no key to mint", async () => {
    await expect(new ContextApiDataSource().createIdentity()).resolves.toEqual({
      data: { publicKey: "acct-me" },
      error: null,
    });
  });

  it("lists the chat instances the account reaches", async () => {
    h.listChatApps.mockResolvedValue([{ appId: "app-1", package: "com.calimero.chat", bundle: "b" }]);
    const res = await new ContextApiDataSource().listContexts();
    expect(res.data).toEqual([{ contextId: "app-1", applicationId: "com.calimero.chat", lastUpdate: 0, rootHash: "" }]);
  });
});
