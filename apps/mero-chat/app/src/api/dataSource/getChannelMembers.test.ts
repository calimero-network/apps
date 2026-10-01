import { beforeEach, describe, expect, it, vi } from "vitest";

const listContextMembers = vi.fn();
const resolve = vi.fn();
const getProfiles = vi.fn();

vi.mock("./groupApiDataSource", () => ({
  GroupApiDataSource: class {
    listContextMembers = listContextMembers;
  },
}));

vi.mock("../../repositories/names/useNames", () => ({
  nameRepository: { resolve: (id: string) => resolve(id) },
}));

vi.mock("@calimero-network/mero-react", () => ({
  getContextId: () => "ctx-1",
  getContextIdentity: () => "device-key",
  getNodeUrl: () => "http://localhost:2428",
}));

import { ClientApiDataSource } from "./clientApiDataSource";

describe("getChannelMembers", () => {
  beforeEach(() => {
    listContextMembers.mockReset();
    resolve.mockReset();
    getProfiles.mockReset();
    resolve.mockImplementation((id: string) => Promise.resolve(`name(${id})`));
  });

  it("lists everyone in the channel, not only those with a profile", async () => {
    // The bug: candidates came from the contract's `get_profiles`, keeping only
    // rows with BOTH an identity and a username. A member who never set one in
    // THIS context could not be @-mentioned — and since every channel is its
    // own context, a name set in one channel was missing in the next.
    listContextMembers.mockResolvedValue({
      data: [{ identity: "aa11" }, { identity: "bb22" }, { identity: "cc33" }],
      error: null,
    });

    const members = await new ClientApiDataSource().getChannelMembers({
      channel: { name: "general" },
    } as never);

    expect([...(members.data?.keys() ?? [])]).toEqual(["aa11", "bb22", "cc33"]);
  });

  it("takes every name from the repository", async () => {
    // Not from a map assembled here. A second resolver with its own precedence
    // is how the same person ends up named one way in the member list and
    // another way in the messages beside it — which is why the previous
    // namespace+alias+profile merge was removed from useChannelMembers.
    listContextMembers.mockResolvedValue({
      data: [{ identity: "aa11" }],
      error: null,
    });
    resolve.mockResolvedValue("TestUser");

    const members = await new ClientApiDataSource().getChannelMembers({
      channel: { name: "general" },
    } as never);

    expect(resolve).toHaveBeenCalledWith("aa11");
    expect(members.data?.get("aa11")).toBe("TestUser");
  });

  it("never asks the contract for profiles", async () => {
    // Pins the change: profiles are a per-context nickname store, not a
    // membership list, and reading them was the whole defect.
    listContextMembers.mockResolvedValue({ data: [{ identity: "aa11" }], error: null });

    const source = new ClientApiDataSource();
    const spy = vi.spyOn(source, "getProfiles");

    await source.getChannelMembers({ channel: { name: "general" } } as never);

    expect(spy).not.toHaveBeenCalled();
  });

  it("returns empty rather than throwing when the roster is unavailable", async () => {
    // A legacy channel with no backing subgroup, or a node that cannot answer.
    // Mentions degrade to none; the composer must still work.
    listContextMembers.mockResolvedValue({ data: null, error: { message: "nope" } });

    const members = await new ClientApiDataSource().getChannelMembers({
      channel: { name: "general" },
    } as never);

    expect(members.data?.size).toBe(0);
    expect(members.error).toBeNull();
  });
});
