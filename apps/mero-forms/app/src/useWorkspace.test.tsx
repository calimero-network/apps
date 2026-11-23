/**
 * How the open workspace keeps up with the node: its event stream starts at
 * the log's head, a write of yours is re-read once (by its event), and a
 * workspace that no longer admits the account is closed.
 */
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { NotFound } from "@calimero-network/mero-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { withRoutes } from "@calimero-apps/connect/testing";

import { SETTLE_MS, useWorkspace } from "./useWorkspace";

const signedIn = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("./sessionContext", () => ({
  useSignedIn: () => ({ client: signedIn.client, after: afterRequest }),
}));
const afterRequest = () => {};
// The safety-net poll ticks on the wall clock's 30s marks; one landing inside a
// test would read as an extra re-read.
vi.mock("./lib/visibleInterval", () => ({ visibleInterval: () => () => {} }));

/** A stream whose events the test pushes, ended by its abort signal. */
function eventStream() {
  const waiting: ((v: void) => void)[] = [];
  let queued = 0;
  const events = vi.fn(async function* (_app: string, _from: number | undefined, signal?: AbortSignal) {
    while (!signal?.aborted) {
      if (queued > 0) {
        queued--;
        yield { id: "9:0", kind: "Changed", data: {} };
        continue;
      }
      await new Promise<void>((resolve) => {
        waiting.push(resolve);
        signal?.addEventListener("abort", () => resolve());
      });
    }
  });
  const push = () => {
    queued++;
    waiting.splice(0).forEach((r) => r());
  };
  return { events, push };
}

/** A stream the node refuses with `error`. */
function refused(error: Error) {
  return vi.fn(() => ({
    [Symbol.asyncIterator]: () => ({ next: () => Promise.reject(error) }),
  }));
}

function fakeNode(events: unknown) {
  const view = vi.fn(async () => ({ index: 7, result: "acct-me", events: [] }));
  const call = vi.fn(async () => ({ index: 8, result: null, events: [] }));
  signedIn.client = withRoutes({ view, call, events });
  return { view, call };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useWorkspace", () => {
  it("streams from the log's head, not from its start", async () => {
    const { events } = eventStream();
    fakeNode(events as never);
    renderHook(() => useWorkspace("app-1"));
    await waitFor(() => expect(events).toHaveBeenCalledWith("app-1", 8, expect.anything()));
  });

  it("re-reads a write of yours once, when its event arrives", async () => {
    const { events, push } = eventStream();
    const { call } = fakeNode(events as never);
    const { result } = renderHook(() => useWorkspace("app-1"));
    await waitFor(() => expect(events).toHaveBeenCalled());
    await act(() => result.current.act((c) => c.deleteForm({ formId: "f1" })));
    expect(call).toHaveBeenCalledTimes(1);
    // Not re-read on the write itself: its event does it.
    expect(result.current.version).toBe(0);
    act(() => push());
    await waitFor(() => expect(result.current.version).toBe(1));
    // No second re-read once the settle time has passed.
    await new Promise((r) => setTimeout(r, SETTLE_MS + 100));
    expect(result.current.version).toBe(1);
  }, 10_000);

  it("re-reads right after a write while there is no stream", async () => {
    const events = refused(new Error("stream refused"));
    fakeNode(events as never);
    const { result } = renderHook(() => useWorkspace("app-1"));
    await waitFor(() => expect(events).toHaveBeenCalled());
    await act(() => result.current.act((c) => c.deleteForm({ formId: "f1" })));
    expect(result.current.version).toBe(1);
  });

  it("closes a workspace that no longer admits the account", async () => {
    const events = refused(new NotFound("not found"));
    fakeNode(events as never);
    const onLost = vi.fn();
    renderHook(() => useWorkspace("app-1", onLost));
    await waitFor(() => expect(onLost).toHaveBeenCalledTimes(1));
  });

  it("closes the workspace when the stream ends and the node then refuses a read", async () => {
    const events = vi.fn(async function* () {});
    const { view } = fakeNode(events as never);
    const onLost = vi.fn();
    const { result } = renderHook(() => useWorkspace("app-1", onLost));
    // The stream ended: the workspace is read again.
    await waitFor(() => expect(result.current.version).toBe(1));
    view.mockRejectedValueOnce(new NotFound("no such app"));
    await expect(result.current.client!.listForms()).rejects.toBeInstanceOf(NotFound);
    expect(onLost).toHaveBeenCalledTimes(1);
  });

  it("keeps the workspace open on a contract's own refusal", async () => {
    const { view } = fakeNode(eventStream().events as never);
    const onLost = vi.fn();
    const { result } = renderHook(() => useWorkspace("app-1", onLost));
    view.mockRejectedValueOnce(Object.assign(new NotFound("no such form"), { appCode: "NotFound" }));
    await expect(result.current.client!.listForms()).rejects.toBeTruthy();
    expect(onLost).not.toHaveBeenCalled();
  });
});
