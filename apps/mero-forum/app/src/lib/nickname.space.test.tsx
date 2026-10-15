// A forum nickname is per forum; the space name is per person. Someone who
// named themselves anywhere on the space should not post here as an account
// id, and renaming here should rename them on the whole space.

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const SELF = "5926f2d2a4940fa2a62edd2cd7d833897c2c1596c697ea674dd0f49b89d11334";
const admin = {
  listGroupMembers: vi.fn(),
  setMemberMetadata: vi.fn().mockResolvedValue(undefined),
  getMemberMetadata: vi.fn().mockResolvedValue(null),
};
vi.mock("@calimero-network/mero-react", () => ({ useMero: () => ({ admin }) }));
let username = "";
vi.mock("./session", async (orig) => ({
  ...(await orig<typeof import("./session")>()),
  getActiveNamespaceId: () => "ns1",
  getUsername: () => username,
  setUsername: (n: string) => {
    username = n;
  },
}));

const { useNickname } = await import("./nickname");
const { memberNames } = await import("@calimero-apps/names");

function client() {
  return { setNickname: vi.fn().mockResolvedValue(undefined) };
}

describe("useNickname – the space name", () => {
  beforeEach(() => {
    username = "";
    memberNames.clear();
    admin.setMemberMetadata.mockClear();
  });

  it("adopts the name you set for the space, and puts it on this forum", async () => {
    admin.listGroupMembers.mockResolvedValue({ members: [{ identity: SELF, name: "Sandi" }] });
    const c = client();
    const { result } = renderHook(() => useNickname(c as never, SELF));
    await waitFor(() => expect(result.current.name).toBe("Sandi"));
    expect(c.setNickname).toHaveBeenCalledWith({ name: "Sandi" });
  });

  it("fills every mounted instance, not just the first to adopt it", async () => {
    admin.listGroupMembers.mockResolvedValue({ members: [{ identity: SELF, name: "Sandi" }] });
    const a = renderHook(() => useNickname(client() as never, SELF));
    const b = renderHook(() => useNickname(client() as never, SELF));
    await waitFor(() => expect(a.result.current.name).toBe("Sandi"));
    await waitFor(() => expect(b.result.current.name).toBe("Sandi"));
  });

  it("keeps a forum nickname you already picked", async () => {
    username = "ana";
    admin.listGroupMembers.mockResolvedValue({ members: [{ identity: SELF, name: "Sandi" }] });
    const { result } = renderHook(() => useNickname(client() as never, SELF));
    await waitFor(() => expect(admin.listGroupMembers).toHaveBeenCalled());
    expect(result.current.name).toBe("ana");
  });

  it("publishes a rename to the whole space", async () => {
    admin.listGroupMembers.mockResolvedValue({ members: [] });
    const { result } = renderHook(() => useNickname(client() as never, SELF));
    await act(() => result.current.rename("Sandi"));
    expect(admin.setMemberMetadata).toHaveBeenCalledWith("ns1", SELF, { name: "Sandi" });
  });
});
