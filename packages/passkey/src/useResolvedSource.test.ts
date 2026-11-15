import { act, renderHook, cleanup } from "@testing-library/react";
import type { CalimeroClient } from "@calimero-network/mero-js";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CHECKING_RELEASE, useResolvedSource } from "./useResolvedSource";

const PKG = "com.example.app";

/** A node whose `packages.get` answers `latest`, and when the test says. */
function node(latest = "2.0.0") {
  const get = vi.fn(async () => ({ package: PKG, latest, versions: [] }));
  return { client: { packages: { get } } as unknown as CalimeroClient, get };
}

afterEach(cleanup);

describe("useResolvedSource", () => {
  it("is pending with the base until the newest release is read, then the source at it", async () => {
    const { client, get } = node();
    const { result } = renderHook(() => useResolvedSource(client, "acct-a", { package: PKG }));
    expect(result.current).toEqual({ source: { package: PKG }, pending: true });
    await act(async () => {});
    expect(result.current).toEqual({ source: { package: PKG, version: "2.0.0" }, pending: false });
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("is never pending for a base that names its version, and reads nothing", async () => {
    const { client, get } = node();
    const base = { package: PKG, version: "1.4.0" };
    const { result } = renderHook(() => useResolvedSource(client, "acct-a", base));
    expect(result.current).toEqual({ source: base, pending: false });
    await act(async () => {});
    expect(result.current).toEqual({ source: base, pending: false });
    expect(get).not.toHaveBeenCalled();
  });

  it("is never pending for a raw bundle, and reads nothing", async () => {
    const { client, get } = node();
    const { result } = renderHook(() => useResolvedSource(client, "acct-a", "bundle-hash"));
    expect(result.current).toEqual({ source: "bundle-hash", pending: false });
    await act(async () => {});
    expect(result.current).toEqual({ source: "bundle-hash", pending: false });
    expect(get).not.toHaveBeenCalled();
  });

  it("reads nothing and is not pending while nobody is signed in", async () => {
    const { client, get } = node();
    const { result } = renderHook(() => useResolvedSource(null, null, { package: PKG }));
    await act(async () => {});
    expect(result.current).toEqual({ source: { package: PKG }, pending: false });
    renderHook(() => useResolvedSource(client, null, { package: PKG }));
    await act(async () => {});
    expect(get).not.toHaveBeenCalled();
  });

  it("reads again for another account on the same client, and is pending meanwhile", async () => {
    const { client, get } = node("2.0.0");
    const { result, rerender } = renderHook(({ account }) => useResolvedSource(client, account, { package: PKG }), { initialProps: { account: "acct-a" } });
    await act(async () => {});
    expect(result.current.source).toEqual({ package: PKG, version: "2.0.0" });
    get.mockResolvedValue({ package: PKG, latest: "3.0.0", versions: [] });
    rerender({ account: "acct-b" });
    expect(result.current).toEqual({ source: { package: PKG }, pending: true });
    await act(async () => {});
    expect(result.current).toEqual({ source: { package: PKG, version: "3.0.0" }, pending: false });
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("reads again for another client", async () => {
    const first = node("2.0.0");
    const second = node("4.0.0");
    const { result, rerender } = renderHook(({ client }) => useResolvedSource(client, "acct-a", { package: PKG }), { initialProps: { client: first.client } });
    await act(async () => {});
    rerender({ client: second.client });
    expect(result.current.pending).toBe(true);
    await act(async () => {});
    expect(result.current.source).toEqual({ package: PKG, version: "4.0.0" });
  });

  it("does not read again for a new object with the same content", async () => {
    const { client, get } = node();
    const { rerender } = renderHook(() => useResolvedSource(client, "acct-a", { package: PKG }));
    await act(async () => {});
    rerender();
    rerender();
    await act(async () => {});
    expect(get).toHaveBeenCalledTimes(1);
  });
});

describe("CHECKING_RELEASE", () => {
  it("is the one line an app says where a create waits, with a single ellipsis character", () => {
    expect(CHECKING_RELEASE).toBe("Checking the newest release\u2026");
    expect(CHECKING_RELEASE).not.toContain("...");
  });
});
