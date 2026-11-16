import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { closeCreateWorkspace, openCreateWorkspace, useCreateWorkspaceOpen } from "./createWorkspaceStore";

describe("the create-workspace dialog's open state", () => {
  it("opens and closes for every reader", () => {
    const a = renderHook(() => useCreateWorkspaceOpen());
    const b = renderHook(() => useCreateWorkspaceOpen());
    expect([a.result.current, b.result.current]).toEqual([false, false]);
    act(() => openCreateWorkspace());
    expect([a.result.current, b.result.current]).toEqual([true, true]);
    act(() => closeCreateWorkspace());
    expect([a.result.current, b.result.current]).toEqual([false, false]);
  });
});
