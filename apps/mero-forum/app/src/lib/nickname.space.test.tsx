// A forum nickname is per forum; the space name is per person. Someone who
// named themselves anywhere on the space should not post here as an account
// id, and renaming here should rename them on the whole space.

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { withRoutes } from "@calimero-apps/connect/testing";

const SELF = "5926f2d2a4940fa2a62edd2cd7d833897c2c1596c697ea674dd0f49b89d11334";
const calimero = withRoutes({
  getOrg: vi.fn(),
  setMemberMetadata: vi.fn().mockResolvedValue(undefined),
});
vi.mock("../sessionContext", () => ({
  useMaybeSignedIn: () => ({ client: calimero, accountId: SELF, after: () => {} }),
}));
let username = "";
vi.mock("./session", async (orig) => ({
  ...(await orig<typeof import("./session")>()),
  getActiveNamespaceId: () => "org1",
  getUsername: () => username,
  setUsername: (n: string) => {
    username = n;
  },
}));

const { forgetSpaceNames, useNickname } = await import("./nickname");

function client() {
  return { setNickname: vi.fn().mockResolvedValue(undefined) };
}

const named = (name: string) => ({
  name: "Space",
  members: { [SELF]: "member" },
  memberMetadata: { [SELF]: { name } },
});

describe("useNickname – the space name", () => {
  beforeEach(() => {
    username = "";
    forgetSpaceNames();
    calimero.getOrg.mockReset();
    calimero.setMemberMetadata.mockClear();
  });

  it("adopts the name you set for the space, and puts it on this forum", async () => {
    calimero.getOrg.mockResolvedValue(named("Sandi"));
    const c = client();
    const { result } = renderHook(() => useNickname(c as never, SELF));
    await waitFor(() => expect(result.current.name).toBe("Sandi"));
    expect(c.setNickname).toHaveBeenCalledWith({ name: "Sandi" });
    expect(calimero.getOrg).toHaveBeenCalledWith("org1");
  });

  it("fills every mounted instance, not just the first to adopt it", async () => {
    calimero.getOrg.mockResolvedValue(named("Sandi"));
    const a = renderHook(() => useNickname(client() as never, SELF));
    const b = renderHook(() => useNickname(client() as never, SELF));
    await waitFor(() => expect(a.result.current.name).toBe("Sandi"));
    await waitFor(() => expect(b.result.current.name).toBe("Sandi"));
  });

  it("keeps a forum nickname you already picked", async () => {
    username = "ana";
    calimero.getOrg.mockResolvedValue(named("Sandi"));
    const { result } = renderHook(() => useNickname(client() as never, SELF));
    await waitFor(() => expect(calimero.getOrg).toHaveBeenCalled());
    expect(result.current.name).toBe("ana");
  });

  it("publishes a rename to the whole space", async () => {
    calimero.getOrg.mockResolvedValue({ name: "Space", members: {}, memberMetadata: {} });
    const { result } = renderHook(() => useNickname(client() as never, SELF));
    await act(() => result.current.rename("Sandi"));
    expect(calimero.setMemberMetadata).toHaveBeenCalledWith("org1", SELF, { name: "Sandi" });
  });
});
