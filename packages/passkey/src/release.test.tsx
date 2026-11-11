import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AppsReport } from "@calimero-network/mero-js";
import type { KeyValueStorage, ReleaseClient } from "@calimero-apps/connect";

import { useInstanceRelease } from "./release";

const HOST = `https://${"a".repeat(52)}.apps.calimero.network`;

function memoryStorage(): KeyValueStorage {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
}

function client(version: string): ReleaseClient {
  return {
    apps: { get: vi.fn(async () => ({ org: null }) as never) },
    appsReportAll: vi.fn(async () => ({ apps: [{ app: "app-1", package: { package: "p", version } }] }) as unknown as AppsReport),
  };
}

describe("useInstanceRelease", () => {
  it("moves to the instance's release and says it is leaving", async () => {
    const navigate = vi.fn();
    const storage = memoryStorage();
    const c = client("1.0.0");
    const { result } = renderHook(() => useInstanceRelease(c, "app-1", { href: `${HOST}/1.2.0/r?q=1`, storage, navigate }));
    await waitFor(() => expect(result.current).toBe(true));
    expect(navigate).toHaveBeenCalledWith(`${HOST}/app/app-1/r?q=1`);
  });

  it("stays on the instance's own release, and with no instance entered", async () => {
    const navigate = vi.fn();
    const storage = memoryStorage();
    const c = client("1.2.0");
    renderHook(() => useInstanceRelease(c, "app-1", { href: `${HOST}/1.2.0/`, storage, navigate }));
    const none = client("1.0.0");
    renderHook(() => useInstanceRelease(none, null, { href: `${HOST}/1.2.0/`, storage, navigate }));
    await waitFor(() => expect(c.appsReportAll).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(navigate).not.toHaveBeenCalled();
    expect(none.apps.get).not.toHaveBeenCalled();
  });
});
