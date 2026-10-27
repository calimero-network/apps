/**
 * An event owner who never set a calendar username used to show as a short
 * pubkey, even when they had named themselves on the team. The team name lives
 * on the namespace, and every calendar should show it.
 */
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const NS = "ab".repeat(32);
const ANA = "a".repeat(64);
const BEN = "b".repeat(64);

const admin = {
  listGroupMembers: vi.fn(async () => ({
    members: [{ identity: ANA, role: "Member", name: "Ana" }],
  })),
};
vi.mock("@calimero-apps/cloud", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()), useMero: () => ({ admin }) }));
// The contract knows Ben by username and Ana not at all.
vi.mock("./useTypedSelector", () => ({
  useTypedSelector: () => [{ id: BEN, username: "ben", avatar: null, joinedAt: 0 }],
}));

import { bindSession, resetSession } from "../api/session";
import { useMembers } from "./useMembers";

afterEach(() => resetSession());

describe("useMembers().displayName", () => {
  it("falls back to the team name before a short pubkey", async () => {
    bindSession({ namespaceId: NS });
    const { result } = renderHook(() => useMembers());
    await waitFor(() => expect(result.current.displayName(ANA)).toBe("Ana"));
    expect(admin.listGroupMembers).toHaveBeenCalledWith(NS);
    expect(result.current.displayName(BEN)).toBe("ben");
  });
});
