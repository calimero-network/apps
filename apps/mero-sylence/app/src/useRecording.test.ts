import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { evictionPlan, sha256Hex, useRecording } from "./useRecording";
import type { WorkspaceBlobs } from "./useWorkspace";

afterEach(cleanup);

describe("evictionPlan", () => {
  const rows = [
    { key: "a/1", size: 100, lastUsed: 3 },
    { key: "a/2", size: 100, lastUsed: 1 },
    { key: "b/3", size: 100, lastUsed: 2 },
  ];
  it("drops nothing under the cap", () => expect(evictionPlan(rows, 300)).toEqual([]));
  it("drops the least recently used first", () => {
    expect(evictionPlan(rows, 200)).toEqual(["a/2"]);
    expect(evictionPlan(rows, 100)).toEqual(["a/2", "b/3"]);
  });
  it("never drops the entry just written", () => expect(evictionPlan(rows, 100, "a/2")).toEqual(["b/3", "a/1"]));
});

describe("useRecording", () => {
  const bytes = new Uint8Array([1, 2, 3, 4]);
  let id = "";
  const created: string[] = [];
  const revoked: string[] = [];
  beforeEach(async () => {
    id = await sha256Hex(bytes.slice().buffer as ArrayBuffer);
    created.length = 0;
    revoked.length = 0;
    let n = 0;
    Object.assign(URL, {
      createObjectURL: vi.fn(() => {
        const url = `blob:rec-${++n}`;
        created.push(url);
        return url;
      }),
      revokeObjectURL: vi.fn((url: string) => revoked.push(url)),
    });
  });

  const blobs = (download: WorkspaceBlobs["download"]): WorkspaceBlobs => ({ appId: "app1", upload: vi.fn(), download });
  const audio = (blob: string) => ({ blob, mime: "audio/mpeg", size: 4, durationMs: 1_000 });

  it("plays a download whose bytes match its id, and revokes the URL on unmount", async () => {
    const b = blobs(async () => bytes.slice().buffer as ArrayBuffer);
    const { result, unmount } = renderHook(() => useRecording(b, audio(id)));
    await waitFor(() => expect(result.current.url).toBe("blob:rec-1"));
    unmount();
    expect(revoked).toEqual(["blob:rec-1"]);
  });

  it("refuses bytes that do not match the id", async () => {
    const b = blobs(async () => new Uint8Array([9, 9]).buffer);
    const { result } = renderHook(() => useRecording(b, audio(id)));
    await waitFor(() => expect(result.current.error).toBe("the recording did not match its id"));
    expect(result.current.url).toBeNull();
    expect(created).toEqual([]);
  });

  it("makes no URL once unmounted mid-download", async () => {
    let release: (v: ArrayBuffer) => void = () => {};
    const b = blobs(() => new Promise<ArrayBuffer>((r) => (release = r)));
    const { unmount } = renderHook(() => useRecording(b, audio(id)));
    unmount();
    await act(async () => {
      release(bytes.slice().buffer as ArrayBuffer);
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(created).toEqual([]);
  });

  it("is idle without audio", () => {
    const b = blobs(vi.fn());
    const { result } = renderHook(() => useRecording(b, null));
    expect(result.current).toEqual({ url: null, loading: false, error: null });
  });
});

describe("within", () => {
  it("answers the fallback when the promise is slow or fails", async () => {
    const { within } = await import("./useRecording");
    expect(await within(new Promise<string>(() => {}), 5, "late")).toBe("late");
    expect(await within(Promise.reject(new Error("x")), 50, "failed")).toBe("failed");
    expect(await within(Promise.resolve("fast"), 50, "late")).toBe("fast");
  });
});
