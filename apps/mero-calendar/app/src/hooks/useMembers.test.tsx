/**
 * An event owner who never set a calendar username shows as the name they set
 * on the team (org member metadata) before a short id.
 */
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

const ANA = "a".repeat(64);
const BEN = "b".repeat(64);
const CY = "c".repeat(64);

// The contract knows Ben by username and Ana not at all.
vi.mock("./useTypedSelector", () => ({
  useTypedSelector: () => [{ id: BEN, username: "ben", joinedAt: 0, usernameUpdatedAt: 0 }],
}));

import { TeamScopeContext } from "../api/teamScope";
import { useMembers } from "./useMembers";

const wrapper = ({ children }: { children: ReactNode }) => (
  <TeamScopeContext.Provider value={{ names: new Map([[ANA, "Ana"]]) }}>{children}</TeamScopeContext.Provider>
);

describe("useMembers().displayName", () => {
  it("prefers the calendar username, then the team name, then a short id", () => {
    const { result } = renderHook(() => useMembers(), { wrapper });
    expect(result.current.displayName(BEN)).toBe("ben");
    expect(result.current.displayName(ANA)).toBe("Ana");
    expect(result.current.displayName(CY)).toBe("cccccc…");
  });
});
