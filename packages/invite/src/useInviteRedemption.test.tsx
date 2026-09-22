import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetInvitationCaptureForTests } from "./capture";
import type { InviteRedeemer } from "./redeem";
import { useInviteRedemption } from "./useInviteRedemption";

const NS = "7d847b7afeab53bef1899496014ce7dae7cecc6e4fda9901b4bdcc706afcc807";

/** The app's codec: here, the token IS the namespace id. */
const parse = (token: string) =>
  token === "BAD"
    ? null
    : { namespaceId: NS, invitation: { group_id: NS }, teamName: "Design" };

function openWith(token: string): void {
  resetInvitationCaptureForTests();
  window.history.replaceState(null, "", `/?invitation=${token}`);
}

function redeemer(over: Partial<InviteRedeemer> = {}): InviteRedeemer {
  return {
    join: vi.fn().mockResolvedValue(undefined),
    memberships: vi.fn().mockResolvedValue([NS]),
    ...over,
  };
}

describe("useInviteRedemption", () => {
  beforeEach(() => {
    resetInvitationCaptureForTests();
    localStorage.clear();
    sessionStorage.clear();
    window.history.replaceState(null, "", "/");
  });
  afterEach(() => {
    resetInvitationCaptureForTests();
    localStorage.clear();
    sessionStorage.clear();
  });

  it("goes joining → joined, and reports the namespace once", async () => {
    openWith("TOK");
    const onJoined = vi.fn();
    const { result } = renderHook(() =>
      useInviteRedemption({ parse, redeemer: redeemer(), onJoined }),
    );

    await waitFor(() => expect(result.current.state.stage).toBe("joined"));
    expect(onJoined).toHaveBeenCalledExactlyOnceWith(NS, "Design");
  });

  // The handoff to the post-join sync gate, so the app the user lands on knows
  // to wait for state rather than render an empty workspace.
  it("marks the namespace as just-joined for the sync gate", async () => {
    openWith("TOK");
    const { result } = renderHook(() =>
      useInviteRedemption({ parse, redeemer: redeemer() }),
    );

    await waitFor(() => expect(result.current.state.stage).toBe("joined"));
    expect(sessionStorage.getItem("calimero:justJoinedNamespaces")).toContain(
      NS,
    );
  });

  it("reports already-member when the request failed but the node joined", async () => {
    openWith("TOK");
    const { result } = renderHook(() =>
      useInviteRedemption({
        parse,
        redeemer: redeemer({
          join: vi.fn().mockRejectedValue(new Error("timed out")),
        }),
      }),
    );

    await waitFor(() =>
      expect(result.current.state.stage).toBe("already-member"),
    );
  });

  it("surfaces a real failure with the node's reason, and keeps the token", async () => {
    openWith("TOK");
    const { result } = renderHook(() =>
      useInviteRedemption({
        parse,
        redeemer: redeemer({
          join: vi
            .fn()
            .mockRejectedValue(new Error("could not reach any member")),
          memberships: vi.fn().mockResolvedValue([]),
        }),
      }),
    );

    await waitFor(() => expect(result.current.state.stage).toBe("failed"));
    expect(result.current.state).toMatchObject({
      message: "could not reach any member",
      retryable: true,
    });
    expect(result.current.token).toBe("TOK");
  });

  it("acks an unreadable invitation instead of letting it replay", async () => {
    openWith("BAD");
    const join = vi.fn();
    const { result } = renderHook(() =>
      useInviteRedemption({ parse, redeemer: redeemer({ join }) }),
    );

    await waitFor(() => expect(result.current.state.stage).toBe("failed"));
    expect(result.current.state).toMatchObject({ retryable: false });
    expect(join).not.toHaveBeenCalled();
  });

  it("does not join until enabled", async () => {
    openWith("TOK");
    const join = vi.fn().mockResolvedValue(undefined);
    const { result, rerender } = renderHook(
      ({ enabled }) =>
        useInviteRedemption({ parse, redeemer: redeemer({ join }), enabled }),
      { initialProps: { enabled: false } },
    );

    expect(join).not.toHaveBeenCalled();
    expect(result.current.state.stage).toBe("idle");

    rerender({ enabled: true });
    await waitFor(() => expect(result.current.state.stage).toBe("joined"));
    expect(join).toHaveBeenCalledTimes(1);
  });

  // The options object is rebuilt on every render in every real app; that must
  // not resubscribe and fire the join again.
  it("joins once across re-renders", async () => {
    openWith("TOK");
    const join = vi.fn().mockResolvedValue(undefined);
    const { result, rerender } = renderHook(() =>
      useInviteRedemption({
        parse: (t) => parse(t),
        redeemer: { join, memberships: () => Promise.resolve([NS]) },
      }),
    );

    await waitFor(() => expect(result.current.state.stage).toBe("joined"));
    rerender();
    rerender();
    expect(join).toHaveBeenCalledTimes(1);
  });

  it("retries by hand past the automatic cap", async () => {
    openWith("TOK");
    const join = vi
      .fn()
      .mockRejectedValueOnce(new Error("could not reach any member"))
      .mockResolvedValue(undefined);
    const memberships = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValue([NS]);
    const { result } = renderHook(() =>
      useInviteRedemption({ parse, redeemer: { join, memberships } }),
    );

    await waitFor(() => expect(result.current.state.stage).toBe("failed"));
    result.current.retry();
    await waitFor(() => expect(result.current.state.stage).toBe("joined"));
    expect(join).toHaveBeenCalledTimes(2);
  });
});
