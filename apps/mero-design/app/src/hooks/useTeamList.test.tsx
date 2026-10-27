// The team list on an account session.
//
// An account's application id lands from the registry AFTER sign-in. Listing
// before it was an unscoped list — every app's namespaces, read as teams — and
// `/teams` opened the first of them, possibly another app's. And a read started
// under an earlier id could answer after the one that replaced it.

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const listNamespaces = vi.fn();
const session = vi.hoisted(() => ({ admin: {}, isDelegated: true, applicationId: null as string | null }));

vi.mock("../api/rpc", () => ({
  createNamespace: vi.fn(),
  deleteNamespace: vi.fn(),
  leaveNamespace: vi.fn(),
  listNamespaces: (...a: unknown[]) => listNamespaces(...a),
}));
vi.mock("@calimero-apps/cloud", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMero: () => ({ ...session }),
}));

const { useTeamList } = await import("./useTeamList");

describe("useTeamList on an account", () => {
  beforeEach(() => {
    listNamespaces.mockReset();
    session.isDelegated = true;
    session.applicationId = null;
  });

  it("waits for the application id instead of listing every app's namespaces", async () => {
    listNamespaces.mockImplementation(async (appId?: string) =>
      appId === "app-1" ? [{ namespaceId: "team-1", name: "Mine" }] : [{ namespaceId: "chess-ns" }],
    );
    const hook = renderHook(() => useTeamList());
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    expect(listNamespaces).not.toHaveBeenCalled();
    expect(hook.result.current.listed).toBe(false);

    session.applicationId = "app-1";
    hook.rerender();
    await waitFor(() => expect(hook.result.current.listed).toBe(true));
    expect(listNamespaces).toHaveBeenCalledWith("app-1");
    expect(hook.result.current.teams).toEqual([{ groupId: "team-1", name: "Mine" }]);
  });

  it("keeps the newest read when an earlier id's read answers last", async () => {
    let answerOld!: (v: unknown) => void;
    listNamespaces.mockImplementation((appId?: string) =>
      appId === "app-old"
        ? new Promise((r) => (answerOld = r))
        : Promise.resolve([{ namespaceId: "team-1", name: "Mine" }]),
    );
    session.applicationId = "app-old";
    const hook = renderHook(() => useTeamList());
    await waitFor(() => expect(listNamespaces).toHaveBeenCalledWith("app-old"));

    session.applicationId = "app-1";
    hook.rerender();
    await waitFor(() => expect(hook.result.current.teams).toEqual([{ groupId: "team-1", name: "Mine" }]));
    await act(async () => { answerOld([{ namespaceId: "other-app-ns" }]); });
    expect(hook.result.current.teams).toEqual([{ groupId: "team-1", name: "Mine" }]);
  });
});
