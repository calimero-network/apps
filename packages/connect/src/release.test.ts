import { describe, expect, it, vi } from "vitest";
import type { AppsReport } from "@calimero-network/mero-js";

import type { KeyValueStorage } from "./client";
import {
  RELEASE_FOLLOW_KEY,
  followInstanceRelease,
  followRelease,
  instanceRelease,
  instanceReleaseUrl,
  servedRelease,
  type ReleaseClient,
} from "./release";

function memoryStorage(): KeyValueStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

const HOST = `https://${"a".repeat(52)}.apps.calimero.network`;

describe("servedRelease", () => {
  it("is the version segment of a page a node serves", () => {
    expect(servedRelease(`${HOST}/1.2.0/deals/7?x=1`)).toBe("1.2.0");
    expect(servedRelease(`${HOST}/1.2.0-rc.1/`)).toBe("1.2.0-rc.1");
    expect(servedRelease(`http://${"b".repeat(52)}.localhost:2428/0.0.1/`)).toBe("0.0.1");
  });

  it("is null in development, on a static host, and off a release path", () => {
    expect(servedRelease("http://localhost:5173/deals/7")).toBeNull();
    expect(servedRelease("https://kv.vercel.app/1.2.0/")).toBeNull();
    expect(servedRelease(`${HOST}/app/x/`)).toBeNull();
    expect(servedRelease(`${HOST}/`)).toBeNull();
    expect(servedRelease("not a url")).toBeNull();
  });
});

describe("instanceReleaseUrl", () => {
  it("goes through /app/{app}/ with the in-app route, query and fragment", () => {
    expect(instanceReleaseUrl(`${HOST}/1.2.0/deals/7?tab=notes&invite=t#c`, "app 1")).toBe(
      `${HOST}/app/app%201/deals/7?tab=notes&invite=t#c`,
    );
    expect(instanceReleaseUrl(`${HOST}/1.2.0/`, "app-1")).toBe(`${HOST}/app/app-1/`);
  });

  it("is null in development", () => {
    expect(instanceReleaseUrl("http://localhost:5173/deals/7", "app-1")).toBeNull();
  });
});

describe("followRelease", () => {
  it("stays when the instance runs this page's release", () => {
    const navigate = vi.fn();
    expect(followRelease({ app: "app-1", release: "1.2.0", href: `${HOST}/1.2.0/x`, storage: memoryStorage(), navigate })).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
  });

  it("moves to the instance's release with the route and query when it runs another", () => {
    const navigate = vi.fn();
    const storage = memoryStorage();
    const moved = followRelease({ app: "app-1", release: "1.0.0", href: `${HOST}/1.2.0/deals/7?tab=a`, storage, navigate });
    expect(moved).toBe(true);
    expect(navigate).toHaveBeenCalledWith(`${HOST}/app/app-1/deals/7?tab=a`);
    expect(JSON.parse(storage.getItem(RELEASE_FOLLOW_KEY)!)).toMatchObject({ app: "app-1", to: "1.0.0" });
  });

  it("never loops: landing on a page that still differs stays put", () => {
    const navigate = vi.fn();
    const storage = memoryStorage();
    followRelease({ app: "app-1", release: "1.0.0", href: `${HOST}/1.2.0/deals/7`, storage, navigate });
    // An old core redirected to another release of the same WASM: still not 1.0.0.
    expect(followRelease({ app: "app-1", release: "1.0.0", href: `${HOST}/1.1.0/deals/7`, storage, navigate })).toBe(false);
    expect(followRelease({ app: "app-1", release: "1.0.0", href: `${HOST}/1.1.0/deals/7`, storage, navigate })).toBe(false);
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it("arriving clears the note, so a later upgrade is followed again", () => {
    const navigate = vi.fn();
    const storage = memoryStorage();
    followRelease({ app: "app-1", release: "1.0.0", href: `${HOST}/1.2.0/`, storage, navigate });
    expect(followRelease({ app: "app-1", release: "1.0.0", href: `${HOST}/1.0.0/`, storage, navigate })).toBe(false);
    expect(storage.getItem(RELEASE_FOLLOW_KEY)).toBeNull();
    expect(followRelease({ app: "app-1", release: "1.3.0", href: `${HOST}/1.0.0/`, storage, navigate })).toBe(true);
    expect(navigate).toHaveBeenCalledTimes(2);
  });

  it("a note for another instance or release, or an old one, does not hold a move back", () => {
    const navigate = vi.fn();
    const storage = memoryStorage();
    storage.setItem(RELEASE_FOLLOW_KEY, JSON.stringify({ app: "app-2", to: "1.0.0", at: Date.now() }));
    expect(followRelease({ app: "app-1", release: "1.0.0", href: `${HOST}/1.2.0/`, storage, navigate })).toBe(true);
    storage.setItem(RELEASE_FOLLOW_KEY, JSON.stringify({ app: "app-1", to: "1.0.0", at: 0 }));
    expect(followRelease({ app: "app-1", release: "1.0.0", href: `${HOST}/1.2.0/`, storage, navigate })).toBe(true);
  });

  it("stays in development, with no release known, and with no storage for the note", () => {
    const navigate = vi.fn();
    expect(followRelease({ app: "app-1", release: "1.0.0", href: "http://localhost:5173/", storage: memoryStorage(), navigate })).toBe(false);
    expect(followRelease({ app: "app-1", release: null, href: `${HOST}/1.2.0/`, storage: memoryStorage(), navigate })).toBe(false);
    expect(followRelease({ app: "app-1", release: "1.0.0", href: `${HOST}/1.2.0/`, storage: null, navigate })).toBe(false);
    const throwing: KeyValueStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota");
      },
      removeItem: () => {},
    };
    expect(followRelease({ app: "app-1", release: "1.0.0", href: `${HOST}/1.2.0/`, storage: throwing, navigate })).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
  });
});

function client(
  version: string | null,
  org: string | null = "org-1",
): ReleaseClient & { appsReportAll: ReturnType<typeof vi.fn>; apps: { get: ReturnType<typeof vi.fn> } } {
  return {
    // Only what `instanceRelease` reads of the app.
    apps: { get: vi.fn(async ({ app }: { app: string }) => ({ appId: app, org }) as never) },
    appsReportAll: vi.fn(
      async () =>
        ({
          apps: [{ app: "app-1", package: version ? { package: "p", version } : null }],
        }) as unknown as AppsReport,
    ),
  };
}

describe("instanceRelease", () => {
  it("reads the release from the instance's scope's report", async () => {
    const c = client("1.0.0");
    expect(await instanceRelease(c, "app-1")).toBe("1.0.0");
    expect(c.appsReportAll).toHaveBeenCalledWith("org-1");
    const own = client("1.0.0", null);
    await instanceRelease(own, "app-1");
    expect(own.appsReportAll).toHaveBeenCalledWith(null);
  });

  it("is null when the report does not say or cannot be read", async () => {
    expect(await instanceRelease(client(null), "app-1")).toBeNull();
    expect(await instanceRelease(client("1.0.0"), "app-9")).toBeNull();
    expect(await instanceRelease({ apps: { get: async () => Promise.reject(new Error("x")) }, appsReportAll: vi.fn() }, "app-1")).toBeNull();
  });
});

describe("followInstanceRelease", () => {
  it("reads nothing in development", async () => {
    const c = client("1.0.0");
    expect(await followInstanceRelease({ client: c, app: "app-1", href: "http://localhost:5173/", navigate: vi.fn() })).toBe(false);
    expect(c.apps.get).not.toHaveBeenCalled();
  });

  it("moves a served page to the instance's release", async () => {
    const navigate = vi.fn();
    const moved = await followInstanceRelease({
      client: client("1.0.0"),
      app: "app-1",
      href: `${HOST}/1.2.0/w?x=1`,
      storage: memoryStorage(),
      navigate,
    });
    expect(moved).toBe(true);
    expect(navigate).toHaveBeenCalledWith(`${HOST}/app/app-1/w?x=1`);
  });
});
