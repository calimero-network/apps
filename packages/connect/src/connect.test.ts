import { AppError, CalimeroClient, LoginRequired, type CalimeroSession } from "@calimero-network/mero-js";
import { describe, expect, it, vi } from "vitest";

import {
  CLOUD_CONSOLE,
  ConfigError,
  LOCAL_NODES,
  NotServedError,
  SessionStore,
  appSource,
  connectTarget,
  createClient,
  describeError,
  policyFor,
  resolveTarget,
  servedNodes,
  targetKey,
  withServedNodes,
  type KeyValueStorage,
  type Target,
} from "./index";

const CLOUD = {
  VITE_CALIMERO_CLUSTER: "eu-shared-1",
  VITE_CALIMERO_MIN_RELEASE: "2.3.109",
};

describe("resolveTarget", () => {
  it("uses the merod local nodes on the dev server", () => {
    expect(resolveTarget({ DEV: true })).toEqual({ kind: "local", nodes: [...LOCAL_NODES] });
  });

  it("takes the local nodes from VITE_CALIMERO_NODES, trimmed", () => {
    expect(
      resolveTarget({ DEV: true, VITE_CALIMERO_NODES: " http://127.0.0.1:2601/ ,http://127.0.0.1:2602" }),
    ).toEqual({ kind: "local", nodes: ["http://127.0.0.1:2601", "http://127.0.0.1:2602"] });
  });

  it("refuses a node that is not an http(s) URL", () => {
    expect(() => resolveTarget({ DEV: true, VITE_CALIMERO_NODES: "localhost:2501" })).toThrow(ConfigError);
    expect(() => resolveTarget({ DEV: true, VITE_CALIMERO_NODES: "ftp://x" })).toThrow(ConfigError);
  });

  it("uses the cloud cluster in a production build", () => {
    expect(resolveTarget({ DEV: false, ...CLOUD, VITE_CALIMERO_ZONE: "europe-west4-a" })).toEqual({
      kind: "cloud",
      cluster: "eu-shared-1",
      minReleaseVersion: "2.3.109",
      zone: "europe-west4-a",
    });
  });

  it("refuses a production build that names no cluster or no trust floor", () => {
    expect(() => resolveTarget({ DEV: false })).toThrow(/VITE_CALIMERO_CLUSTER/);
    expect(() => resolveTarget({ DEV: false, VITE_CALIMERO_CLUSTER: "eu-shared-1" })).toThrow(
      /VITE_CALIMERO_MIN_RELEASE/,
    );
  });

  it("reaches an attested node directly by URL, with no directory and no picker", () => {
    expect(
      resolveTarget({
        DEV: false,
        VITE_CALIMERO_TARGET: "node",
        VITE_CALIMERO_NODES: "https://node.example.com/, https://node-2.example.com",
        VITE_CALIMERO_MIN_RELEASE: "2.3.109",
      }),
    ).toEqual({
      kind: "cloud",
      cluster: "node.example.com",
      direct: true,
      nodes: ["https://node.example.com", "https://node-2.example.com"],
      minReleaseVersion: "2.3.109",
    });
  });

  it("refuses a node target with no URL, a plain-http URL or no trust floor", () => {
    const floor = { VITE_CALIMERO_MIN_RELEASE: "2.3.109" };
    expect(() => resolveTarget({ VITE_CALIMERO_TARGET: "node", ...floor })).toThrow(/VITE_CALIMERO_NODES/);
    expect(() =>
      resolveTarget({ VITE_CALIMERO_TARGET: "node", VITE_CALIMERO_NODES: "http://node.example.com", ...floor }),
    ).toThrow(/not https/);
    expect(() =>
      resolveTarget({ VITE_CALIMERO_TARGET: "node", VITE_CALIMERO_NODES: "https://node.example.com" }),
    ).toThrow(/VITE_CALIMERO_MIN_RELEASE/);
  });

  it("lets VITE_CALIMERO_TARGET override the mode either way", () => {
    expect(resolveTarget({ DEV: false, VITE_CALIMERO_TARGET: "local" }).kind).toBe("local");
    expect(resolveTarget({ DEV: true, VITE_CALIMERO_TARGET: "cloud", ...CLOUD }).kind).toBe("cloud");
    expect(() => resolveTarget({ VITE_CALIMERO_TARGET: "staging" })).toThrow(ConfigError);
  });
});

describe("policyFor", () => {
  it("trusts mock quotes for local nodes only", () => {
    expect(policyFor({ kind: "local", nodes: [...LOCAL_NODES] })).toEqual({ allowMock: true });
    const cloud = policyFor(resolveTarget({ ...CLOUD }));
    expect(cloud).toEqual({ release: { minReleaseVersion: "2.3.109" } });
    expect(cloud.allowMock).toBeUndefined();
  });
});

describe("targetKey", () => {
  it("keeps sessions for a direct node apart from a cloud cluster", () => {
    const node = resolveTarget({
      VITE_CALIMERO_TARGET: "node",
      VITE_CALIMERO_NODES: "https://node.example.com",
      VITE_CALIMERO_MIN_RELEASE: "2.3.109",
    });
    expect(targetKey(node)).toBe("node:https://node.example.com");
    expect(targetKey(resolveTarget({ ...CLOUD }))).toBe("cloud:eu-shared-1");
    expect(policyFor(node)).toEqual({ release: { minReleaseVersion: "2.3.109" } });
  });
});

describe("appSource", () => {
  it("is the dev bundle when one was deployed, else the package", () => {
    expect(appSource({ VITE_CALIMERO_BUNDLE: "ab12" }, "com.example.app")).toBe("ab12");
    expect(appSource({}, "com.example.app")).toEqual({ package: "com.example.app" });
    expect(appSource({ VITE_CALIMERO_PACKAGE: "com.example.other", VITE_CALIMERO_VERSION: "1.2.3" }, "x.y")).toEqual({
      package: "com.example.other",
      version: "1.2.3",
    });
  });
});

describe("createClient", () => {
  it("fails over across the local nodes in order", async () => {
    const client = await createClient({ kind: "local", nodes: ["http://a:1", "http://b:2", "http://c:3"] });
    expect(client.nodeUrl).toBe("http://a:1");
    expect(client.nodes).toEqual(["http://a:1", "http://b:2", "http://c:3"]);
  });

  it("reaches a cloud cluster by name through the directory", async () => {
    const connect = vi.spyOn(CalimeroClient, "connect").mockResolvedValue({} as CalimeroClient);
    await createClient({ kind: "cloud", cluster: "eu-shared-1", minReleaseVersion: "2.3.109", zone: "z" });
    expect(connect).toHaveBeenCalledWith({
      cluster: "eu-shared-1",
      zone: "z",
      policy: { release: { minReleaseVersion: "2.3.109" } },
    });
    connect.mockRestore();
  });
});

class MemoryStorage implements KeyValueStorage {
  readonly items = new Map<string, string>();
  writes = 0;
  getItem(key: string) {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.writes += 1;
    this.items.set(key, value);
  }
  removeItem(key: string) {
    this.items.delete(key);
  }
}

const SESSION: CalimeroSession = { accountId: "acct", sessionToken: "s", refreshToken: "r", expiresAt: 1 };
const LOCAL: Target = { kind: "local", nodes: [...LOCAL_NODES] };

describe("SessionStore", () => {
  it("keeps one session per app and per target", () => {
    const storage = new MemoryStorage();
    new SessionStore("kv-store", LOCAL, storage).save(SESSION);
    expect(new SessionStore("kv-store", LOCAL, storage).load()).toEqual(SESSION);
    expect(new SessionStore("other-app", LOCAL, storage).load()).toBeNull();
    const cloud = resolveTarget({ ...CLOUD });
    expect(new SessionStore("kv-store", cloud, storage).load()).toBeNull();
    expect(new SessionStore("kv-store", cloud, storage).key).toBe(`calimero-session:kv-store:${targetKey(cloud)}`);
  });

  it("drops a stored value that is not a session", () => {
    const storage = new MemoryStorage();
    const store = new SessionStore("kv-store", LOCAL, storage);
    storage.setItem(store.key, JSON.stringify({ accountId: "acct" }));
    expect(store.load()).toBeNull();
    expect(storage.items.has(store.key)).toBe(false);
    storage.setItem(store.key, "{not json");
    expect(store.load()).toBeNull();
  });

  it("writes only when the client's session changed", () => {
    const storage = new MemoryStorage();
    const store = new SessionStore("kv-store", LOCAL, storage);
    store.sync({ session: undefined });
    expect(storage.writes).toBe(0);
    store.sync({ session: SESSION });
    store.sync({ session: { ...SESSION } });
    expect(storage.writes).toBe(1);
    store.sync({ session: { ...SESSION, refreshToken: "r2" } });
    expect(storage.writes).toBe(2);
  });

  it("restores a stored session onto the client", () => {
    const storage = new MemoryStorage();
    const store = new SessionStore("kv-store", LOCAL, storage);
    const useSession = vi.fn();
    expect(store.restore({ useSession })).toBe(false);
    store.save(SESSION);
    expect(store.restore({ useSession })).toBe(true);
    expect(useSession).toHaveBeenCalledWith(SESSION);
    store.clear();
    expect(store.load()).toBeNull();
  });
});

describe("describeError", () => {
  it("names an app error by its code and fields", () => {
    const e = new AppError("x", { code: "NotFound", fields: { key: "k" } });
    expect(describeError(e)).toBe(`${e.appCode} ${JSON.stringify(e.fields)}`);
    expect(describeError(new LoginRequired("no session"))).toBe("Sign in first.");
    expect(describeError(new Error("boom"))).toBe("boom");
    expect(describeError("plain")).toBe("plain");
  });
});

describe("served frontends", () => {
  const json = (body: unknown, status = 200) =>
    vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

  it("reads the cluster's API URLs from /.well-known/calimero.json", async () => {
    const fetcher = json({ package: "com.x", api: ["https://n1.example", "https://n2.example", 7] });
    expect(await servedNodes("https://abc.apps.example", fetcher)).toEqual(["https://n1.example", "https://n2.example"]);
    expect(fetcher).toHaveBeenCalledWith("https://abc.apps.example/.well-known/calimero.json", expect.anything());
  });

  it("is null off a served page", async () => {
    expect(await servedNodes("https://x.vercel.app", json({}, 404))).toBeNull();
    expect(await servedNodes("https://x.example", json({ api: [] }))).toBeNull();
    expect(await servedNodes("", json({ api: ["https://n"] }))).toBeNull();
    const broken = vi.fn(async () => {
      throw new TypeError("offline");
    }) as unknown as typeof fetch;
    expect(await servedNodes("https://x.example", broken)).toBeNull();
  });

  it("puts the served nodes on a cloud target and uses them instead of the directory", async () => {
    const cloud = resolveTarget({ ...CLOUD });
    const served = await withServedNodes(cloud, async () => ["https://n1.example", "https://n2.example"]);
    expect(served).toEqual({ ...cloud, nodes: ["https://n1.example", "https://n2.example"] });
    expect(await withServedNodes(cloud, async () => null)).toEqual(cloud);
    expect(await withServedNodes(LOCAL, async () => ["https://n"])).toEqual(LOCAL);

    const connect = vi.spyOn(CalimeroClient, "connect");
    const client = await createClient(served);
    expect(connect).not.toHaveBeenCalled();
    expect(client.nodes).toEqual(["https://n1.example", "https://n2.example"]);
    connect.mockRestore();
  });
});

describe("connectTarget", () => {
  const SERVED = ["https://n1.example", "https://n2.example"];
  const HOST = "abc.apps.example";
  const FLOOR = { VITE_CALIMERO_MIN_RELEASE: "2.3.136" };

  it("connects a served page to the nodes that serve it with no VITE_CALIMERO_CLUSTER", async () => {
    const target = await connectTarget(FLOOR, { servedNodes: async () => SERVED, host: HOST });
    expect(target).toEqual({ kind: "cloud", cluster: HOST, nodes: SERVED, minReleaseVersion: "2.3.136" });
    expect(targetKey(target)).toBe(`cloud:${HOST}`);
    expect(policyFor(target)).toEqual({ release: { minReleaseVersion: "2.3.136" } });

    const connect = vi.spyOn(CalimeroClient, "connect");
    const client = await createClient(target);
    expect(connect).not.toHaveBeenCalled();
    expect(client.nodes).toEqual(SERVED);
    connect.mockRestore();
  });

  it("still needs the attestation floor on a served page", async () => {
    await expect(connectTarget({}, { servedNodes: async () => SERVED, host: HOST })).rejects.toThrow(
      /VITE_CALIMERO_MIN_RELEASE is not set/,
    );
  });

  it("tells a page no cluster serves, built without a cluster, to open the app from Calimero Cloud", async () => {
    const failure = connectTarget(FLOOR, { servedNodes: async () => null, app: "kv-store" });
    await expect(failure).rejects.toBeInstanceOf(NotServedError);
    await expect(failure).rejects.toBeInstanceOf(ConfigError);
    await expect(failure).rejects.toThrow(/kv-store's listing page; open the app from Calimero Cloud/);
    await expect(failure).rejects.toThrow(CLOUD_CONSOLE);
    await expect(failure).rejects.toThrow(/VITE_CALIMERO_CLUSTER is not set/);
    expect(CLOUD_CONSOLE).toBe("https://cloud.calimero.network");
  });

  it("keeps every other path as resolveTarget and withServedNodes had it", async () => {
    const none = async () => null;
    expect(await connectTarget({ DEV: true }, { servedNodes: none })).toEqual(LOCAL);
    expect(await connectTarget({ ...CLOUD }, { servedNodes: none })).toEqual(resolveTarget({ ...CLOUD }));
    expect(await connectTarget({ ...CLOUD }, { servedNodes: async () => SERVED, host: HOST })).toEqual({
      ...resolveTarget({ ...CLOUD }),
      nodes: SERVED,
    });
    await expect(connectTarget({ VITE_CALIMERO_TARGET: "moon" }, { servedNodes: none })).rejects.toThrow(
      /VITE_CALIMERO_TARGET/,
    );
    // The served list is not even asked for when the build names its cluster or runs locally.
    const find = vi.fn(async () => SERVED);
    await connectTarget({ DEV: true }, { servedNodes: find });
    expect(find).not.toHaveBeenCalled();
  });
});
