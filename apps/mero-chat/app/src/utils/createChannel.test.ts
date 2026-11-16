import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../constants/config", () => ({
  getGroupId: () => "ns-old",
  getApplicationId: () => "app-1",
  setContextMemberIdentity: vi.fn(),
}));

import { createChannel } from "./createChannel";

function api() {
  return {
    createSubgroup: vi.fn(async () => ({ data: { groupId: "sg-1" }, error: null })),
    setSubgroupVisibility: vi.fn(async () => ({ data: undefined, error: null })),
    createGroupContext: vi.fn(async () => ({ data: { contextId: "ctx-1", memberPublicKey: "key-1" }, error: null })),
  };
}

beforeEach(() => localStorage.clear());

describe("createChannel", () => {
  it("makes the channel without writing a name into it", async () => {
    const a = api();
    const made = await createChannel("ns-new", "general", true, a as never);
    expect(made).toEqual({ contextId: "ctx-1", memberKey: "key-1" });
    const params = a.createGroupContext.mock.calls[0] as unknown as [{ initializationParams: Record<string, unknown> }];
    expect(params[0].initializationParams.creator_username).toBe("");
  });
});
