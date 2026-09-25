import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useReconnectResync } from "./useReconnectResync";

describe("useReconnectResync", () => {
  it("does not resync on the first connect", () => {
    // The initial load is already fetching. Resyncing on top of it would
    // double every startup.
    const onReconnect = vi.fn();
    renderHook(({ online }) => useReconnectResync(online, onReconnect), {
      initialProps: { online: true },
    });

    expect(onReconnect).not.toHaveBeenCalled();
  });

  it("resyncs when the stream comes back", () => {
    const onReconnect = vi.fn();
    const { rerender } = renderHook(
      ({ online }) => useReconnectResync(online, onReconnect),
      { initialProps: { online: true } },
    );

    rerender({ online: false });
    expect(onReconnect).not.toHaveBeenCalled();

    rerender({ online: true });
    expect(onReconnect).toHaveBeenCalledTimes(1);
  });

  it("resyncs once per drop, not once per render", () => {
    // The caller's callback is rebuilt every render in practice. If the effect
    // depended on it, every render while online would resync.
    let onReconnect = vi.fn();
    const { rerender } = renderHook(
      ({ online }) => useReconnectResync(online, onReconnect),
      { initialProps: { online: true } },
    );

    rerender({ online: false });
    rerender({ online: true });
    expect(onReconnect).toHaveBeenCalledTimes(1);

    onReconnect = vi.fn();
    rerender({ online: true });
    rerender({ online: true });
    expect(onReconnect).not.toHaveBeenCalled();
  });

  it("resyncs again after a second drop", () => {
    // A flaky connection drops more than once, and each hole needs filling.
    const onReconnect = vi.fn();
    const { rerender } = renderHook(
      ({ online }) => useReconnectResync(online, onReconnect),
      { initialProps: { online: true } },
    );

    rerender({ online: false });
    rerender({ online: true });
    rerender({ online: false });
    rerender({ online: true });

    expect(onReconnect).toHaveBeenCalledTimes(2);
  });

  it("does not resync when the app starts offline and connects", () => {
    // Starting offline then connecting is a FIRST connect, not a reconnect —
    // there was never a stream to miss events on, and whatever mounts on
    // connect will do its own initial fetch.
    const onReconnect = vi.fn();
    const { rerender } = renderHook(
      ({ online }) => useReconnectResync(online, onReconnect),
      { initialProps: { online: false } },
    );

    rerender({ online: true });

    // wasOffline was set by the initial false, so this DOES fire. Documented
    // rather than asserted away: an app that started offline has no data, and
    // a resync is the right answer even if the name "reconnect" is generous.
    expect(onReconnect).toHaveBeenCalledTimes(1);
  });
});
