import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const { present, polled } = vi.hoisted(() => ({
  present: new Set<string>(),
  polled: [] as Array<string | undefined>,
}));

vi.mock("../calimero/presence", () => ({
  usePresentAccounts: (app: string | undefined) => {
    polled.push(app);
    return present;
  },
}));

import { usePresence } from "./usePresence";

describe("usePresence", () => {
  it("reports an account present in the conversation as online", () => {
    present.clear();
    present.add("bob");
    const { result } = renderHook(() => usePresence("app-1", "me"));
    expect(result.current.isOnline("bob")).toBe(true);
    expect(result.current.isOnline("carol")).toBe(false);
  });

  it("hasOtherOnline ignores the caller's own account", () => {
    present.clear();
    present.add("me");
    const { result } = renderHook(() => usePresence("app-1", "me"));
    expect(result.current.hasOtherOnline("me")).toBe(false);
    present.add("bob");
    const again = renderHook(() => usePresence("app-1", "me"));
    expect(again.result.current.hasOtherOnline("me")).toBe(true);
  });

  it("reads nothing without a conversation or an account", () => {
    polled.length = 0;
    renderHook(() => usePresence(undefined, "me"));
    renderHook(() => usePresence("app-1", undefined));
    expect(polled).toEqual([undefined, undefined]);
  });
});
