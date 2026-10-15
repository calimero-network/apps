// A player who took a corner without typing a name showed as `Fighter` (or a short
// id), even when they had named themselves for the whole namespace.

import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { memberNames } from "@calimero-apps/names";
import type { FighterView, ArenaView } from "./generated/MeroKombatClient";

const ME = "5926f2d2a4940fa2a62edd2cd7d833897c2c1596c697ea674dd0f49b89d11334";
const OTHER = "a".repeat(64);
const admin = {
  listGroupMembers: vi.fn(),
  getMemberMetadata: vi.fn(),
  setMemberMetadata: vi.fn(),
};
vi.mock("@calimero-network/mero-react", () => ({
  useMero: () => ({ admin }),
  useContextGroup: () => ({ groupId: "ns1", loading: false, error: null }),
}));

const { useCornerNames } = await import("./useCornerNames");

const corner = (f: Partial<FighterView>): FighterView =>
  ({ seat: "p1", member: "", name: "", fighter: "kinetic", ...f }) as FighterView;
const arena = (p1: FighterView, p2: FighterView) => ({ me: ME, p1, p2 }) as unknown as ArenaView;

describe("useCornerNames – namespace names", () => {
  beforeEach(() => {
    memberNames.clear();
    window.localStorage.clear();
    vi.clearAllMocks();
    admin.listGroupMembers.mockResolvedValue({ members: [{ identity: ME, role: "Admin", name: "Sandi" }] });
    admin.getMemberMetadata.mockResolvedValue(null);
    admin.setMemberMetadata.mockResolvedValue(undefined);
  });

  it("names a Fighter corner from the namespace and keeps an arena name", async () => {
    const view = arena(corner({ member: ME, name: "Fighter" }), corner({ seat: "p2", member: OTHER, name: "Ana" }));
    const { result } = renderHook(() => useCornerNames("ctx1", view));
    await waitFor(() => expect(result.current.view?.p1.name).toBe("Sandi"));
    expect(result.current.view?.p2.name).toBe("Ana");
    expect(admin.listGroupMembers).toHaveBeenCalledWith("ns1");
  });

  it("falls back to a short id, never the full key", async () => {
    const view = arena(corner({ member: OTHER, name: "" }), corner({ seat: "p2" }));
    const { result } = renderHook(() => useCornerNames("ctx1", view));
    await waitFor(() => expect(admin.listGroupMembers).toHaveBeenCalled());
    expect(result.current.view?.p1.name).toBe("aaaaaa…aaaa");
    expect(result.current.view?.p2.name).toBe("");
  });

  it("prefills a blank name field with the namespace name", async () => {
    const view = arena(corner({}), corner({ seat: "p2" }));
    const { result } = renderHook(() => useCornerNames("ctx1", view));
    await waitFor(() => expect(result.current.name).toBe("Sandi"));
    expect(window.localStorage.getItem("mero-kombat:name")).toBe("Sandi");
  });

  it("prefills every mounted field, not just the first to load", async () => {
    // The first instance to see the namespace name stored it; a second found
    // it "already stored" and never set its own field, which stayed blank.
    const view = arena(corner({}), corner({ seat: "p2" }));
    const a = renderHook(() => useCornerNames("ctx1", view));
    const b = renderHook(() => useCornerNames("ctx1", view));
    await waitFor(() => expect(a.result.current.name).toBe("Sandi"));
    await waitFor(() => expect(b.result.current.name).toBe("Sandi"));
  });

  it("publishes the name a player fights under namespace-wide", async () => {
    const view = arena(corner({}), corner({ seat: "p2" }));
    const { result } = renderHook(() => useCornerNames("ctx1", view));
    result.current.publish("Bob");
    await waitFor(() => expect(admin.setMemberMetadata).toHaveBeenCalledWith("ns1", ME, { name: "Bob" }));
  });
});
