import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useOrg } from "./useOrg";
import type { OrgBackend } from "./backend";

function fakeBackend(): OrgBackend {
  const org = { name: "Calimero", icon: "", admins: ["aa"], member_count: 0, group_count: 0, app_count: 0 };
  const b: Partial<OrgBackend> = {
    org: vi.fn(async () => org),
    members: vi.fn(async () => []),
    groups: vi.fn(async () => []),
    apps: vi.fn(async () => []),
    accessRows: vi.fn(async () => []),
    enrolments: vi.fn(async () => []),
    createGroup: vi.fn(async (name: string) => ({ id: "g1", name, parent: "", admins: [], member_count: 0, created_at: 1 })),
  };
  return b as OrgBackend;
}

describe("useOrg", () => {
  it("loads every table once and re-reads after a mutation", async () => {
    const backend = fakeBackend();
    const { result } = renderHook(() => useOrg(backend, 0));
    await waitFor(() => expect(result.current.org?.name).toBe("Calimero"));
    expect(backend.groups).toHaveBeenCalledTimes(1);
    await result.current.run((b) => b.createGroup("Eng", ""));
    await waitFor(() => expect(backend.groups).toHaveBeenCalledTimes(2));
    expect(result.current.error).toBeNull();
  });

  it("surfaces a mutation error and keeps the last good state", async () => {
    const backend = fakeBackend();
    (backend.createGroup as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("only an org admin can do this"));
    const { result } = renderHook(() => useOrg(backend, 0));
    await waitFor(() => expect(result.current.org).not.toBeNull());
    const out = await result.current.run((b) => b.createGroup("Eng", ""));
    expect(out).toBeNull();
    await waitFor(() => expect(result.current.error).toContain("org admin"));
    expect(result.current.org?.name).toBe("Calimero");
  });
});
