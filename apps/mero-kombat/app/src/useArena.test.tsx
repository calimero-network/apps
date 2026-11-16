import { act, renderHook, waitFor } from "@testing-library/react";
import { withRoutes } from "@calimero-apps/connect/testing";
import { describe, expect, it, vi } from "vitest";

import { useArena } from "./useArena";

/** An arena whose event stream stays open until aborted (`open`), or closes at once. */
function fakeArena({ open, refuse = false }: { open: boolean; refuse?: boolean }) {
  const fake = {
    call: vi.fn(async () => {
      if (refuse) throw new Error("SeatTaken");
      return { index: 2, result: null as unknown, events: [] };
    }),
    view: vi.fn(async () => ({ index: 1, result: { title: "Arena" } as unknown })),
    events: vi.fn(async function* (_app: string, _from: number, signal?: AbortSignal) {
      if (open) await new Promise((resolve) => signal?.addEventListener("abort", resolve));
      yield* [];
    }),
    presenceStream: vi.fn(async function* () {}),
    presencePublish: vi.fn(async () => ({})),
  };
  return { fake, client: withRoutes(fake) };
}

const reads = (view: ReturnType<typeof vi.fn>) => view.mock.calls.length;

describe("useArena", () => {
  it("leaves the read after a call to the open event stream", async () => {
    const { fake, client } = fakeArena({ open: true });
    const { result } = renderHook(() => useArena({ client, appId: "app-1" }));
    await waitFor(() => expect(result.current.view).not.toBeNull());
    await waitFor(() => expect(fake.events).toHaveBeenCalled());
    const before = reads(fake.view);
    await act(() => result.current.stand());
    expect(fake.call).toHaveBeenCalled();
    expect(reads(fake.view)).toBe(before);
  });

  it("reads again after a refused call", async () => {
    const { fake, client } = fakeArena({ open: true, refuse: true });
    const { result } = renderHook(() => useArena({ client, appId: "app-1" }));
    await waitFor(() => expect(result.current.view).not.toBeNull());
    await waitFor(() => expect(fake.events).toHaveBeenCalled());
    const before = reads(fake.view);
    await act(() => result.current.stand());
    expect(reads(fake.view)).toBe(before + 1);
  });

  it("reads again after a call while no stream is open", async () => {
    const { fake, client } = fakeArena({ open: false });
    const { result } = renderHook(() => useArena({ client, appId: "app-1" }));
    await waitFor(() => expect(result.current.view).not.toBeNull());
    await waitFor(() => expect(fake.events).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 0));
    const before = reads(fake.view);
    await act(() => result.current.stand());
    expect(reads(fake.view)).toBe(before + 1);
  });
});
