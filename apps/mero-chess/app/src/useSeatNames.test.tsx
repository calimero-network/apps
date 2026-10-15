// A player who sat down without typing a name showed as `Guest` (or a short
// id), even when they had named themselves for the whole namespace.

import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { memberNames } from "@calimero-apps/names";
import type { SeatView, TableView } from "./generated/MeroChessClient";

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

const { useSeatNames } = await import("./useSeatNames");

const seat = (s: Partial<SeatView>): SeatView => ({ seat: "white", member: "", name: "", online: true, ...s });
const table = (white: SeatView, black: SeatView) => ({ me: ME, white, black }) as unknown as TableView;

describe("useSeatNames – namespace names", () => {
  beforeEach(() => {
    memberNames.clear();
    window.localStorage.clear();
    vi.clearAllMocks();
    admin.listGroupMembers.mockResolvedValue({ members: [{ identity: ME, role: "Admin", name: "Sandi" }] });
    admin.getMemberMetadata.mockResolvedValue(null);
    admin.setMemberMetadata.mockResolvedValue(undefined);
  });

  it("names a Guest seat from the namespace and keeps a table name", async () => {
    const view = table(seat({ member: ME, name: "Guest" }), seat({ seat: "black", member: OTHER, name: "Ana" }));
    const { result } = renderHook(() => useSeatNames("ctx1", view));
    await waitFor(() => expect(result.current.view?.white.name).toBe("Sandi"));
    expect(result.current.view?.black.name).toBe("Ana");
    expect(admin.listGroupMembers).toHaveBeenCalledWith("ns1");
  });

  it("falls back to a short id, never the full key", async () => {
    const view = table(seat({ member: OTHER, name: "" }), seat({ seat: "black" }));
    const { result } = renderHook(() => useSeatNames("ctx1", view));
    await waitFor(() => expect(admin.listGroupMembers).toHaveBeenCalled());
    expect(result.current.view?.white.name).toBe("aaaaaa…aaaa");
    expect(result.current.view?.black.name).toBe("");
  });

  it("prefills a blank name field with the namespace name", async () => {
    const view = table(seat({}), seat({ seat: "black" }));
    const { result } = renderHook(() => useSeatNames("ctx1", view));
    await waitFor(() => expect(result.current.name).toBe("Sandi"));
    expect(window.localStorage.getItem("mero-chess:name")).toBe("Sandi");
  });

  it("prefills every mounted field, not just the first to load", async () => {
    // Two components on the table read the same name. The first to see the
    // namespace name stored it, and the second then found it "already stored"
    // and never set its own field, so it stayed blank.
    const view = table(seat({}), seat({ seat: "black" }));
    const a = renderHook(() => useSeatNames("ctx1", view));
    const b = renderHook(() => useSeatNames("ctx1", view));
    await waitFor(() => expect(a.result.current.name).toBe("Sandi"));
    await waitFor(() => expect(b.result.current.name).toBe("Sandi"));
  });

  it("publishes the name a player sits under namespace-wide", async () => {
    const view = table(seat({}), seat({ seat: "black" }));
    const { result } = renderHook(() => useSeatNames("ctx1", view));
    result.current.publish("Bob");
    await waitFor(() => expect(admin.setMemberMetadata).toHaveBeenCalledWith("ns1", ME, { name: "Bob" }));
  });
});
