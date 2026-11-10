import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../constants/config", () => ({
  // The workspace on screen: still the previous one while a new one is made.
  getGroupId: () => "ns-old",
  getApplicationId: () => "app-1",
  setContextMemberIdentity: vi.fn(),
}));

import { createChannel, joinPendingChannels } from "./createChannel";
import { setMessengerDisplayName } from "./messengerName";

function api() {
  return {
    createSubgroup: vi.fn(async () => ({ data: { groupId: "sg-1" }, error: null })),
    setSubgroupVisibility: vi.fn(async () => ({ data: undefined, error: null })),
    createGroupContext: vi.fn(async () => ({ data: { contextId: "ctx-1", memberPublicKey: "key-1" }, error: null })),
    joinChat: vi.fn(async () => ({ data: undefined, error: null })),
  };
}

beforeEach(() => localStorage.clear());

describe("createChannel", () => {
  it("writes your name in the workspace the channel is made in, not the one on screen", async () => {
    setMessengerDisplayName("Fran", "ns-old");
    setMessengerDisplayName("Sandi", "ns-new");
    const a = api();
    await createChannel("ns-new", "general", true, a as never);
    expect(a.joinChat).toHaveBeenCalledWith({ contextId: "ctx-1", executorPublicKey: "key-1", username: "Sandi" });
  });

  it("waits for the workspace's name when it has none yet, then writes it", async () => {
    setMessengerDisplayName("Fran", "ns-old");
    const a = api();
    await createChannel("ns-new", "general", true, a as never);
    expect(a.joinChat).not.toHaveBeenCalled();

    await joinPendingChannels("ns-new", "Sandi", a as never);
    expect(a.joinChat).toHaveBeenCalledWith({ contextId: "ctx-1", executorPublicKey: "key-1", username: "Sandi" });

    a.joinChat.mockClear();
    await joinPendingChannels("ns-new", "Sandi", a as never);
    expect(a.joinChat).not.toHaveBeenCalled();
  });
});
