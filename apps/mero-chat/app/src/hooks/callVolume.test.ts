import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const markAsRead = vi.fn(async () => ({ data: "ok", error: null }));
vi.mock("../api/dataSource/clientApiDataSource", () => ({
  ClientApiDataSource: class {
    markAsRead = markAsRead;
  },
}));

import { markRead, READ_MARKER_INTERVAL_MS, resetReadMarkers } from "./useUnreadCounts";
import { ensureAdminRole, resetEnsureAdminRole } from "./ensureAdminRole";
import { visibleInterval } from "../utils/visibleInterval";

describe("markRead", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    markAsRead.mockClear();
    resetReadMarkers();
  });
  afterEach(() => vi.useRealTimers());

  it("writes once at once, then folds a burst into one trailing write", () => {
    const t0 = Date.now();
    markRead("ctx", "me", t0);
    expect(markAsRead).toHaveBeenCalledTimes(1);

    for (let i = 1; i <= 20; i++) markRead("ctx", "me", t0 + i * 100);
    expect(markAsRead).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(READ_MARKER_INTERVAL_MS);
    expect(markAsRead).toHaveBeenCalledTimes(2);
    expect(markAsRead).toHaveBeenLastCalledWith(
      expect.objectContaining({ contextId: "ctx", timestamp: Math.floor((t0 + 2000) / 1000) }),
    );
  });

  it("keeps contexts independent", () => {
    markRead("a", "me");
    markRead("b", "me");
    expect(markAsRead).toHaveBeenCalledTimes(2);
  });
});

describe("ensureAdminRole", () => {
  beforeEach(() => resetEnsureAdminRole());

  it("reads once per context and writes only when the role is missing", async () => {
    const api = {
      getMemberRole: vi.fn(async () => ({ data: "Admin" as const, error: null })),
      setMemberRole: vi.fn(async () => ({ data: "ok", error: null })),
    };
    await ensureAdminRole("ctx", "me", "acct", api as never);
    await ensureAdminRole("ctx", "me", "acct", api as never);
    expect(api.getMemberRole).toHaveBeenCalledTimes(1);
    expect(api.setMemberRole).not.toHaveBeenCalled();

    api.getMemberRole.mockResolvedValueOnce({ data: "User" as never, error: null });
    await ensureAdminRole("other", "me", "acct", api as never);
    expect(api.setMemberRole).toHaveBeenCalledWith(expect.objectContaining({ contextId: "other", role: "Admin" }));
  });

  it("tries again after a failed read", async () => {
    const api = {
      getMemberRole: vi.fn(async () => ({ data: null, error: { code: 1, message: "not joined" } })),
      setMemberRole: vi.fn(),
    };
    await ensureAdminRole("ctx", "me", "acct", api as never);
    await ensureAdminRole("ctx", "me", "acct", api as never);
    expect(api.getMemberRole).toHaveBeenCalledTimes(2);
    expect(api.setMemberRole).not.toHaveBeenCalled();
  });
});

describe("visibleInterval", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("skips ticks while hidden and catches up when visible", () => {
    const tick = vi.fn();
    let state: DocumentVisibilityState = "visible";
    vi.spyOn(document, "visibilityState", "get").mockImplementation(() => state);
    const stop = visibleInterval(tick, 1000);

    vi.advanceTimersByTime(1000);
    expect(tick).toHaveBeenCalledTimes(1);

    state = "hidden";
    vi.advanceTimersByTime(5000);
    expect(tick).toHaveBeenCalledTimes(1);

    state = "visible";
    document.dispatchEvent(new Event("visibilitychange"));
    expect(tick).toHaveBeenCalledTimes(2);

    stop();
    vi.advanceTimersByTime(5000);
    expect(tick).toHaveBeenCalledTimes(2);
  });
});
