// A team's boards, as the rail and the team home share them.
//
// Deleting a board: through its subgroup, which takes it out of every listing.
// The group delete only unregisters the context, so the node's own copy is
// deleted first, best-effort: `deleteContext` is not on the app's token (no
// `context:delete`) and answered every app 403, which must not stop the delete. The board goes only once
// the delete went through: a refusal used to be swallowed and the card dropped
// anyway, so a 403 looked like a delete until the next reload brought it back.
//
// Creating one: the new board comes back (the shell opens it) and is listed.

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const deleteContext = vi.fn();
const deleteGroup = vi.fn();
const createSubgroup = vi.fn();
const createContext = vi.fn();

const CTX = "5f4be3609f2916888dcfc0d6568bbcbb2778381cf9669f69738a056ee2617346";
const GROUP = "group-1";

vi.mock("../api/rpc", () => ({
  createContext: (...a: unknown[]) => createContext(...a),
  createSubgroup: (...a: unknown[]) => createSubgroup(...a),
  deleteContext: (...a: unknown[]) => deleteContext(...a),
  deleteGroup: (...a: unknown[]) => deleteGroup(...a),
  listGroupContexts: vi.fn().mockResolvedValue([{ contextId: CTX, name: "Poster" }]),
  listSubgroups: vi.fn().mockResolvedValue([{ groupId: GROUP, name: "Poster" }]),
  renameBoard: vi.fn(),
  setSubgroupVisibility: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("./useApplicationId", () => ({
  useApplicationId: () => async () => "app-1",
}));
vi.mock("@calimero-network/mero-react", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMero: () => ({ admin: null }),
}));

const { useBoardList } = await import("./useBoardList");

async function listed() {
  const hook = renderHook(() => useBoardList("team-1"));
  await waitFor(() => expect(hook.result.current.listedFor).toBe("team-1"));
  return hook;
}

describe("useBoardList", () => {
  beforeEach(() => {
    deleteContext.mockReset();
    deleteGroup.mockReset();
    deleteContext.mockResolvedValue(undefined);
    createSubgroup.mockReset();
    createContext.mockReset();
  });

  it("lists each subgroup's board", async () => {
    const { result } = await listed();
    expect(result.current.boards).toEqual([
      expect.objectContaining({ contextId: CTX, groupId: GROUP, name: "Poster" }),
    ]);
  });

  it("deletes the board's context, then its subgroup", async () => {
    deleteGroup.mockResolvedValue(undefined);
    const { result } = await listed();
    await act(() => result.current.deleteBoard(result.current.boards[0]!));
    expect(deleteContext).toHaveBeenCalledWith(CTX);
    expect(deleteGroup).toHaveBeenCalledWith(GROUP);
    expect(result.current.boards).toEqual([]);
  });

  it("still deletes the subgroup when the node refuses the context delete (an app token)", async () => {
    deleteContext.mockRejectedValue(Object.assign(new Error("HTTP 403"), { status: 403 }));
    deleteGroup.mockResolvedValue(undefined);
    const { result } = await listed();
    await act(() => result.current.deleteBoard(result.current.boards[0]!));
    expect(deleteGroup).toHaveBeenCalledWith(GROUP);
    expect(result.current.boards).toEqual([]);
  });

  it("falls back to the context for a board created straight in the team", async () => {
    deleteContext.mockResolvedValue(undefined);
    const { result } = await listed();
    const board = { ...result.current.boards[0]!, groupId: "team-1" };
    await act(() => result.current.deleteBoard(board));
    expect(deleteContext).toHaveBeenCalledWith(CTX);
    expect(deleteGroup).not.toHaveBeenCalled();
  });

  it("keeps the board and rejects with the node's reason when it refuses", async () => {
    deleteGroup.mockRejectedValue(
      Object.assign(new Error("HTTP 403"), {
        explanation: "caller lacks the permissions this route requires",
      }),
    );
    const { result } = await listed();
    await act(async () => {
      await expect(result.current.deleteBoard(result.current.boards[0]!)).rejects.toThrow("HTTP 403");
    });
    expect(result.current.boards.map((b) => b.contextId)).toEqual([CTX]);
  });

  it("creates a board under its own subgroup and lists it", async () => {
    createSubgroup.mockResolvedValue("sg-new");
    createContext.mockResolvedValue("ctx-new");
    const { result } = await listed();
    let board: Awaited<ReturnType<typeof result.current.createBoard>> | undefined;
    await act(async () => {
      board = await result.current.createBoard("  Launch  ");
    });
    expect(board).toEqual(expect.objectContaining({ contextId: "ctx-new", groupId: "sg-new", name: "Launch" }));
    expect(createContext).toHaveBeenCalledWith(
      expect.objectContaining({ applicationId: "app-1", groupId: "sg-new", name: "Launch" }),
    );
    expect(result.current.boards.map((b) => b.contextId)).toEqual([CTX, "ctx-new"]);
  });
});
