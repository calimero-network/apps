// The one switch: a node session gets mero-js's node client (bearer against
// `{node}/admin-api` + `/jsonrpc`); an account session gets the account admin
// + the delegated (relay) rpc, and NO request ever goes to a node route.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fakes = vi.hoisted(() => {
  const rpc = {
    kind: "relay" as const,
    canSubscribe: true,
    execute: vi.fn(async () => ({ name: "w", seed: 1, createdAt: 2 })),
    executeWithMetadata: vi.fn(),
    migrateMyEntries: vi.fn(),
    countMyPending: vi.fn(),
  };
  const relayAdmin = { getContexts: vi.fn(async () => ({ contexts: [{ id: "ctx-relay", applicationId: "app" }] })) };
  const events = { on: vi.fn(), connect: vi.fn(), subscribe: vi.fn(), close: vi.fn() };
  const client = { rpc, admin: relayAdmin, events, close: vi.fn() };
  const accountAdmin = { getContexts: relayAdmin.getContexts, getNodeIdentity: vi.fn(async () => ({ accountId: "acct" })) };
  return {
    rpc,
    relayAdmin,
    client,
    accountAdmin,
    buildDelegatedClient: vi.fn(() => client),
    createAccountAdmin: vi.fn(() => accountAdmin),
    resolveRelayNodeKey: vi.fn(async () => "relay-node-key"),
    resolveApplicationIdFromRegistry: vi.fn(async () => ({ applicationId: "app-from-registry", signerId: "s", version: "1.2.3" })),
  };
});

vi.mock("@calimero-network/mero-js", async (importOriginal) => {
  const real = await importOriginal<typeof import("@calimero-network/mero-js")>();
  return {
    ...real,
    buildDelegatedClient: fakes.buildDelegatedClient,
    createAccountAdmin: fakes.createAccountAdmin,
    resolveRelayNodeKey: fakes.resolveRelayNodeKey,
    resolveApplicationIdFromRegistry: fakes.resolveApplicationIdFromRegistry,
  };
});

import { saveDelegatedSession } from "@calimero-network/mero-js";
import {
  adoptAccountSession,
  getSession,
  isAuthenticated,
  resetSession,
  sessionKind,
  updateSession,
} from "../src/net/session";
import { getTransport, merrariaTokenStore, NO_RELAY_MESSAGE, resetTransport } from "../src/net/transport";
import { GameClient } from "../src/net/client";

// A device secret whose ed25519 public key is known: the all-zero seed.
const DEVICE_SECRET = "0".repeat(64);
const DEVICE_PUBLIC_KEY = "3b6a27bcceb6a42d62a3a8d02a6f0d73653215771de243a63ac048a18b59da29";

const okJson = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function accountSession(relayUrl: string | null) {
  saveDelegatedSession({ account: "a".repeat(64), credential: "cafe", deviceSecret: DEVICE_SECRET, relayUrl });
  adoptAccountSession({ contextId: "ctx-1" });
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  resetSession();
  resetTransport();
  vi.clearAllMocks();
});
afterEach(() => vi.restoreAllMocks());

describe("session kind", () => {
  it("is null with nothing stored, node with a node url, account with a delegated session", () => {
    expect(sessionKind()).toBeNull();
    updateSession({ kind: "node", nodeUrl: "http://node:2428" });
    expect(sessionKind()).toBe("node");
    accountSession("http://relay.example");
    expect(sessionKind()).toBe("account");
    expect(getSession().nodeUrl).toBeNull(); // nothing from the node login leaks
    expect(isAuthenticated()).toBe(true);
  });

  it("a stored account session whose credential is gone is no session at all", () => {
    accountSession("http://relay.example");
    sessionStorage.clear(); // new tab / cleared site data: mero-js's record is per tab
    expect(sessionKind()).toBeNull();
    expect(isAuthenticated()).toBe(false);
  });

  it("refuses to build a transport with no session", async () => {
    await expect(getTransport()).rejects.toThrow(/not logged in/);
  });
});

describe("node session → mero-js node client", () => {
  beforeEach(() => {
    updateSession({ kind: "node", nodeUrl: "http://node:2428", contextId: "ctx-1", executorPublicKey: null });
    localStorage.setItem("mero-tokens", JSON.stringify({ access_token: "tok-123", refresh_token: "", expires_at: "" }));
  });

  it("executes over POST {node}/jsonrpc with the bearer and the camelCase envelope", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      okJson({ jsonrpc: "2.0", id: 1, result: { output: Array.from(new TextEncoder().encode('{"seed":7}')) } }),
    );
    const t = await getTransport();
    expect(t.kind).toBe("node");
    const client = new GameClient(Promise.resolve(t));
    expect(await client.exec("world_meta", {})).toEqual({ seed: 7 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("http://node:2428/jsonrpc");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer tok-123");
    const body = JSON.parse(init!.body as string);
    expect(body.method).toBe("execute");
    expect(Object.keys(body.params).sort()).toEqual(["argsJson", "contextId", "method"]);
    expect(body.params.contextId).toBe("ctx-1");
    expect(fakes.buildDelegatedClient).not.toHaveBeenCalled();
    expect(fakes.createAccountAdmin).not.toHaveBeenCalled();
  });

  it("myId is the hash's identity, else what the node owns for the context, never a cache", async () => {
    updateSession({ executorPublicKey: "pk-from-hash" });
    expect(await (await getTransport()).myId("ctx-1")).toBe("pk-from-hash");

    updateSession({ executorPublicKey: null });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(okJson({ data: { identities: ["pk-owned"] } }));
    expect(await (await getTransport()).myId("ctx-1")).toBe("pk-owned");
    expect(String(fetchMock.mock.calls[0][0])).toBe("http://node:2428/admin-api/contexts/ctx-1/identities-owned");

    fetchMock.mockResolvedValue(okJson({ data: { identities: [] } }));
    expect(await (await getTransport()).myId("ctx-1")).toBeNull();
  });

  it("the token store serves a bundle with no refresh token (a desktop hand-over)", () => {
    expect(merrariaTokenStore().getTokens()).toMatchObject({ access_token: "tok-123", refresh_token: "" });
    localStorage.removeItem("mero-tokens");
    expect(merrariaTokenStore().getTokens()).toBeNull();
  });
});

describe("account session → account admin + delegated rpc", () => {
  it("attests the relay, builds the delegated client and the account admin over its reads", async () => {
    accountSession("https://relay.example");
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const t = await getTransport();
    expect(t.kind).toBe("account");
    expect(fakes.resolveRelayNodeKey).toHaveBeenCalledWith("https://relay.example");
    expect(fakes.buildDelegatedClient).toHaveBeenCalledTimes(1);
    const [input, deps] = fakes.createAccountAdmin.mock.calls[0] as unknown as [
      { session: { account: string }; read: unknown; app: { packageName: string } },
      { join: unknown; found: unknown; routing: unknown },
    ];
    expect(input.read).toBe(fakes.relayAdmin);
    expect(input.app.packageName).toBe("com.calimero.merraria");
    expect(typeof deps.join).toBe("function");
    expect(typeof deps.found).toBe("function");
    expect(t.admin).toBe(fakes.accountAdmin);
    expect(t.rpc).toBe(fakes.rpc);
    expect(t.events()).toBe(fakes.client.events);

    // every data call rides those two surfaces …
    const client = new GameClient(Promise.resolve(t));
    expect(await client.exec("world_meta", {})).toEqual({ name: "w", seed: 1, createdAt: 2 });
    expect(fakes.rpc.execute).toHaveBeenCalledWith({ contextId: "ctx-1", method: "world_meta", argsJson: {} });
    expect(await t.admin.getContexts()).toEqual({ contexts: [{ id: "ctx-relay", applicationId: "app" }] });
    // … and no raw node route was ever touched
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("myId is the delegated device's signing key — what the contract's device_id() sees — not the account", async () => {
    accountSession("https://relay.example");
    const t = await getTransport();
    expect(await t.myId("ctx-1")).toBe(DEVICE_PUBLIC_KEY);
    expect(await new GameClient(Promise.resolve(t)).resolveIdentity()).toBe(DEVICE_PUBLIC_KEY);
    expect(fakes.accountAdmin.getNodeIdentity).not.toHaveBeenCalled();
  });

  it("resolves the application id from the registry, never from an installed list", async () => {
    accountSession("https://relay.example");
    const t = await getTransport();
    expect(await t.resolveApplicationId()).toBe("app-from-registry");
    expect(fakes.resolveApplicationIdFromRegistry).toHaveBeenCalledWith(
      "https://apps.calimero.network",
      "com.calimero.merraria",
    );
    expect(getSession().applicationId).toBe("app-from-registry");
    // cached for the next call
    expect(await t.resolveApplicationId()).toBe("app-from-registry");
    expect(fakes.resolveApplicationIdFromRegistry).toHaveBeenCalledTimes(1);
  });

  it("an account with no relay yet is signed in, reads nothing and refuses to execute by name", async () => {
    accountSession(null);
    const t = await getTransport();
    expect(fakes.buildDelegatedClient).not.toHaveBeenCalled();
    expect(fakes.resolveRelayNodeKey).not.toHaveBeenCalled();
    const [input] = fakes.createAccountAdmin.mock.calls[0] as unknown as [{ read: unknown }];
    expect(input.read).toBeNull();
    expect(t.events()).toBeNull();
    await expect(t.rpc.execute({ contextId: "ctx-1", method: "world_meta" })).rejects.toThrow(NO_RELAY_MESSAGE);
    await expect(new GameClient(Promise.resolve(t)).exec("world_meta", {})).rejects.toThrow(/rpc world_meta: .*no relay yet/);
  });

  it("is rebuilt when the session changes (a join that moved the account onto a relay)", async () => {
    accountSession(null);
    const before = await getTransport();
    accountSession("https://relay.example");
    const after = await getTransport();
    expect(after).not.toBe(before);
    expect(fakes.buildDelegatedClient).toHaveBeenCalledTimes(1);
    expect(await getTransport()).toBe(after); // and cached until it changes again
  });
});
