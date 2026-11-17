/**
 * A team that no longer admits the account is closed: the stream's refusal,
 * or, when the stream just ends, the node's refusal of the re-read.
 */
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { NotFound } from "@calimero-network/mero-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { withRoutes } from "@calimero-apps/connect/testing";

import { useTeam, type TeamTransport } from "./useTeam";

function fakeNode(events: unknown) {
  const view = vi.fn(async () => ({ index: 7, result: "acct-me", events: [] }));
  const call = vi.fn(async () => ({ index: 8, result: null, events: [] }));
  return { transport: withRoutes({ view, call, events }) as unknown as TeamTransport, view };
}

const after = () => {};

afterEach(cleanup);

describe("useTeam", () => {
  it("closes the team when its stream is refused", async () => {
    const events = vi.fn(() => ({
      [Symbol.asyncIterator]: () => ({ next: () => Promise.reject(new NotFound("not found")) }),
    }));
    const { transport } = fakeNode(events);
    const onLost = vi.fn();
    renderHook(() => useTeam(transport, "app-1", after, onLost));
    await waitFor(() => expect(onLost).toHaveBeenCalledTimes(1));
  });

  it("re-reads when the stream ends, and closes the team when the node refuses the read", async () => {
    const { transport, view } = fakeNode(vi.fn(async function* () {}));
    const onLost = vi.fn();
    const { result } = renderHook(() => useTeam(transport, "app-1", after, onLost));
    await waitFor(() => expect(result.current.version).toBe(1));
    view.mockRejectedValueOnce(new NotFound("no such app"));
    await expect(result.current.client.teamName()).rejects.toBeInstanceOf(NotFound);
    expect(onLost).toHaveBeenCalledTimes(1);
  });

  it("keeps the team open on the contract's own refusal", async () => {
    const { transport, view } = fakeNode(vi.fn(async function* () {}));
    const onLost = vi.fn();
    const { result } = renderHook(() => useTeam(transport, "app-1", after, onLost));
    view.mockRejectedValueOnce(Object.assign(new NotFound("no such day"), { appCode: "NotFound" }));
    await expect(result.current.client.teamName()).rejects.toBeTruthy();
    expect(onLost).not.toHaveBeenCalled();
  });
});
