// The transport switch (src/net/transport.ts): an ACCOUNT session routes
// every admin write through the mero-js account admin and every contract call
// through the delegated client — and never a node route — while a NODE
// session keeps the raw routes it always had. Also pins how "me" is resolved
// on each side, which is what every `p.id === myId` comparison depends on.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const rpcExecute = vi.fn(async (_p: unknown) => ({ name: "w", seed: 7, createdAt: 1 }));
  const sse = {
    on: vi.fn(),
    connect: vi.fn(async () => {}),
    subscribe: vi.fn(async (_ids: string[]) => {}),
    close: vi.fn(),
  };
  const client = { rpc: { execute: rpcExecute }, admin: { tag: "relay-reads" }, events: sse };
  const calls: string[] = [];
  const rec =
    <T,>(name: string, impl: (...a: never[]) => T) =>
    (...a: never[]) => {
      calls.push(name);
      return impl(...a);
    };
  const admin = {
    createNamespace: vi.fn(
      rec("createNamespace", async () => ({
        namespaceId: "ns-acc",
        haEnabled: false,
        haError: "link this account to your cloud user in the wallet so invitees can find this namespace",
      })),
    ),
    createGroupInNamespace: vi.fn(rec("createGroupInNamespace", async () => ({ groupId: "grp-acc" }))),
    createContext: vi.fn(
      rec("createContext", async () => ({ contextId: "ctx-acc", memberPublicKey: "acc0unt", groupId: "grp-acc" })),
    ),
    getContextIdentitiesOwned: vi.fn(rec("getContextIdentitiesOwned", async () => ({ identities: ["acc0unt"] }))),
    joinContext: vi.fn(rec("joinContext", async () => ({ contextId: "ctx-acc", memberPublicKey: "acc0unt" }))),
    getContextGroup: vi.fn(rec("getContextGroup", async () => "grp-acc")),
    listNamespaces: vi.fn(rec("listNamespaces", async () => [{ namespaceId: "abcd" }])),
    listNamespacesForApplication: vi.fn(rec("listNamespacesForApplication", async () => [{ namespaceId: "ns-acc" }])),
    listNamespaceGroups: vi.fn(rec("listNamespaceGroups", async () => [{ groupId: "grp-acc" }])),
    getGroupInfo: vi.fn(rec("getGroupInfo", async () => ({ subgroupVisibility: "Open" }))),
    setSubgroupVisibility: vi.fn(rec("setSubgroupVisibility", async () => {})),
    createNamespaceInvitation: vi.fn(
      rec("createNamespaceInvitation", async () => ({
        invitation: { invitation: { groupId: [1] }, inviter_signature: "acc-sig" },
      })),
    ),
    joinNamespace: vi.fn(rec("joinNamespace", async () => ({ namespaceId: "abcd" }))),
    joinSubgroupInheritance: vi.fn(rec("joinSubgroupInheritance", async () => ({ wasInherited: true }))),
    syncGroup: vi.fn(rec("syncGroup", async () => ({}))),
    listGroupContexts: vi.fn(rec("listGroupContexts", async () => [])),
    getContexts: vi.fn(async () => ({ contexts: [] })),
  };
  return {
    calls,
    admin,
    client,
    sse,
    rpcExecute,
    session: {
      account: "acc0unt",
      credential: "cred",
      deviceSecret: "00".repeat(32),
      relayUrl: "https://relay.test" as string | null,
    },
    pinned: "ab".repeat(32) as string | null,
    buildDelegatedClient: vi.fn((_s: unknown) => client),
    createAccountAdmin: vi.fn((_input: unknown, _deps: unknown) => admin),
    learnRelayNodeKey: vi.fn(async () => "cd".repeat(32)),
    listDelegatedContexts: vi.fn(async () => [
      { id: "ctx-acc", applicationId: "app-reg", relayUrl: "https://relay.test" },
      { id: "ctx-other", applicationId: "other-app", relayUrl: "https://relay.test" },
    ]),
    resolveApplicationIdFromRegistry: vi.fn(async () => ({ applicationId: "app-reg", signerId: "s", version: "1.0.0" })),
    signerFromSecret: vi.fn(async () => ({ publicKey: "de".repeat(32), sign: async () => new Uint8Array() })),
  };
});

vi.mock("@calimero-network/mero-js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@calimero-network/mero-js")>();
  return {
    ...actual,
    readDelegatedSession: () => mocks.session,
    saveDelegatedSession: vi.fn(),
    readPinnedRelayNodeKey: () => mocks.pinned,
    relayForContext: () => null,
    buildDelegatedClient: mocks.buildDelegatedClient,
    createAccountAdmin: mocks.createAccountAdmin,
    learnRelayNodeKey: mocks.learnRelayNodeKey,
    listDelegatedContexts: mocks.listDelegatedContexts,
    resolveApplicationIdFromRegistry: mocks.resolveApplicationIdFromRegistry,
    signerFromSecret: mocks.signerFromSecret,
  };
});

import {
  acceptWorldInvite,
  createWorld,
  createWorldInvite,
  listWorlds,
  resolveApplicationId,
} from "../src/net/admin";
import { toGroupInvitation } from "../src/net/accountTransport";
import { PACKAGE_NAME, REGISTRY_URL } from "../src/net/auth";
import { GameClient } from "../src/net/client";
import { encodeInvite } from "../src/net/inviteCodec";
import {
  adoptAccountSession,
  clearSession,
  getSession,
  resetSession,
  updateSession,
} from "../src/net/session";
import { getTransport, resetTransport } from "../src/net/transport";

const okJson = (body: unknown) => ({ ok: true, json: async () => body }) as Response;

let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  resetSession();
  resetTransport();
  mocks.calls.length = 0;
  mocks.session.relayUrl = "https://relay.test";
  mocks.pinned = "ab".repeat(32);
  for (const fn of Object.values(mocks.admin)) fn.mockClear();
  mocks.buildDelegatedClient.mockClear();
  mocks.createAccountAdmin.mockClear();
  mocks.learnRelayNodeKey.mockClear();
  mocks.rpcExecute.mockClear();
  mocks.sse.subscribe.mockClear();
  fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(okJson({ data: [] }));
});
afterEach(() => vi.restoreAllMocks());

const asAccount = () => {
  adoptAccountSession();
  resetTransport();
};

describe("the switch", () => {
  it("is a node transport by default and an account transport after adoptAccountSession", () => {
    expect(getTransport().kind).toBe("node");
    asAccount();
    expect(getTransport().kind).toBe("account");
    clearSession();
    expect(getTransport().kind).toBe("node");
  });

  it("builds the account transport from the delegated session and the account admin over the relay client", () => {
    asAccount();
    getTransport();
    expect(mocks.buildDelegatedClient).toHaveBeenCalledWith(
      expect.objectContaining({ account: "acc0unt", relayUrl: "https://relay.test" }),
      null,
    );
    const [input, deps] = mocks.createAccountAdmin.mock.calls[0] as [Record<string, unknown>, Record<string, unknown>];
    expect(input.read).toBe(mocks.client.admin); // reads go to the relay
    expect(input.app).toEqual({ packageName: PACKAGE_NAME, registryUrl: REGISTRY_URL });
    // the provider-side deps mero-react wires: join (bootstrap for the
    // account), found (HA on the cloud), routing (invitation claimability)
    expect(typeof deps.join).toBe("function");
    expect(typeof deps.found).toBe("function");
    expect(typeof deps.routing).toBe("function");
    // the relay's key is already pinned: nothing to learn
    expect(mocks.learnRelayNodeKey).not.toHaveBeenCalled();
  });

  it("learns the relay's node key before serving reads, then rebuilds the client with it", async () => {
    mocks.pinned = null;
    asAccount();
    const transport = getTransport(); // built once, unsigned, so writes already work
    const built = mocks.buildDelegatedClient.mock.calls.length;
    await transport.ready();
    expect(mocks.learnRelayNodeKey).toHaveBeenCalledWith("https://relay.test");
    expect(mocks.buildDelegatedClient.mock.calls.length).toBe(built + 1);
  });
});

describe("account session: every data call goes through the account layer", () => {
  beforeEach(asAccount);

  it("resolves the application id from the registry, never from a node's installed apps", async () => {
    updateSession({ applicationId: "stale-from-a-node" });
    expect(await resolveApplicationId()).toBe("app-reg");
    expect(mocks.resolveApplicationIdFromRegistry).toHaveBeenCalledWith(REGISTRY_URL, PACKAGE_NAME);
    expect(getSession().applicationId).toBe("app-reg"); // the stale node id is replaced
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("lists worlds from the account's contexts across its relays", async () => {
    const worlds = await listWorlds("app-reg");
    expect(worlds.map((w) => w.contextId)).toEqual(["ctx-acc"]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("creates a world as namespace → open subgroup → context through signed warrants, and surfaces haError", async () => {
    const created = await createWorld("app-reg", "myworld", 42);
    expect(mocks.calls).toEqual(["createNamespace", "createGroupInNamespace", "createContext"]);
    expect(mocks.admin.createNamespace).toHaveBeenCalledWith({ applicationId: "app-reg", name: "myworld" });
    expect(mocks.admin.createGroupInNamespace).toHaveBeenCalledWith("ns-acc", { groupName: "myworld", visibility: "open" });
    const ctxReq = mocks.admin.createContext.mock.calls[0][0] as Record<string, unknown>;
    expect(ctxReq.applicationId).toBe("app-reg");
    expect(ctxReq.groupId).toBe("grp-acc");
    const params = JSON.parse(new TextDecoder().decode(new Uint8Array(ctxReq.initializationParams as number[])));
    expect(params).toMatchObject({ name: "myworld", seed: 42 });
    expect(created).toMatchObject({ contextId: "ctx-acc", namespaceId: "ns-acc", groupId: "grp-acc" });
    // the cloud declined to host: said, not swallowed (rule 3)
    expect(created.haError).toContain("link this account");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("executes contract calls on the delegated client's rpc (relay reads / intent writes)", async () => {
    updateSession({ contextId: "ctx-acc" });
    const meta = await new GameClient().fetchWorldMeta();
    expect(meta.seed).toBe(7);
    expect(mocks.rpcExecute).toHaveBeenCalledWith({ contextId: "ctx-acc", method: "world_meta", argsJson: {} });
    expect(fetchSpy).not.toHaveBeenCalled(); // no POST /jsonrpc
  });

  it("subscribes the world on the delegated client's event stream", () => {
    updateSession({ contextId: "ctx-acc" });
    new GameClient().subscribe(() => {});
    expect(mocks.sse.subscribe).toHaveBeenCalledWith(["ctx-acc"]);
    expect(fetchSpy).not.toHaveBeenCalled(); // no node /sse
  });

  it("mints an invite with the account's signed namespace invitation", async () => {
    updateSession({ contextId: "ctx-acc", namespaceId: "ns-acc", groupId: "grp-acc", worldName: "myworld" });
    const code = await createWorldInvite();
    expect(typeof code).toBe("string");
    expect(mocks.admin.createNamespaceInvitation).toHaveBeenCalledWith("ns-acc");
    expect(mocks.admin.getGroupInfo).toHaveBeenCalledWith("grp-acc"); // open-check before minting
    expect(mocks.admin.setSubgroupVisibility).not.toHaveBeenCalled(); // already open
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("redeems an invite through admin.joinNamespace (snake_case signature), then inheritance + joinContext", async () => {
    const code = encodeInvite({
      invitation: { invitation: { groupId: [0xab, 0xcd] }, inviterSignature: "node-sig" },
      groupAlias: "friend's world",
      contextId: "ctx-acc",
      groupId: "grp-acc",
    });
    expect(await acceptWorldInvite(code)).toBe("ctx-acc");
    expect(mocks.admin.joinNamespace).toHaveBeenCalledWith("abcd", {
      invitation: { invitation: { groupId: [0xab, 0xcd] }, inviter_signature: "node-sig" },
      groupName: "friend's world",
    });
    expect(mocks.calls).toEqual([
      "joinNamespace",
      "listNamespaces", // membership settles the redeem
      "joinSubgroupInheritance",
      "joinContext",
      "getContextIdentitiesOwned",
    ]);
    expect(getSession()).toMatchObject({ contextId: "ctx-acc", namespaceId: "abcd", groupId: "grp-acc" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("refuses contract calls while the account has no relay yet", async () => {
    mocks.session.relayUrl = null;
    mocks.buildDelegatedClient.mockReturnValueOnce(null as never);
    resetTransport();
    updateSession({ contextId: "ctx-acc" });
    await expect(new GameClient().fetchWorldMeta()).rejects.toThrow(/no relay/);
  });
});

describe("myId resolution", () => {
  it("account: the delegated device's signing key — the contract keys by device_id(), not the account", async () => {
    asAccount();
    updateSession({ contextId: "ctx-acc", executorPublicKey: "acc0unt" }); // what joinWorld stored
    expect(await new GameClient().resolveIdentity()).toBe("de".repeat(32));
    expect(mocks.signerFromSecret).toHaveBeenCalledWith("00".repeat(32), "deviceSecret");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("node: the hash's executor key when there is one", async () => {
    updateSession({ nodeUrl: "http://node:2428", contextId: "ctx-n", executorPublicKey: "pk-hash" });
    localStorage.setItem("mero-tokens", JSON.stringify({ access_token: "t" }));
    expect(await new GameClient().resolveIdentity()).toBe("pk-hash");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("node: else what the node reports owning, and null when it owns nothing", async () => {
    updateSession({ nodeUrl: "http://node:2428", contextId: "ctx-n" });
    localStorage.setItem("mero-tokens", JSON.stringify({ access_token: "t" }));
    fetchSpy.mockResolvedValueOnce(okJson({ data: ["pk-owned"] }));
    expect(await new GameClient().resolveIdentity()).toBe("pk-owned");
    expect(String(fetchSpy.mock.calls[0][0])).toBe("http://node:2428/admin-api/contexts/ctx-n/identities-owned");
    fetchSpy.mockResolvedValueOnce(okJson({ data: [] }));
    expect(await new GameClient().resolveIdentity()).toBeNull();
  });
});

describe("toGroupInvitation", () => {
  it("normalises either signature spelling to the one mero-js verifies", () => {
    const inv = { groupId: [1] };
    expect(toGroupInvitation({ invitation: inv, inviterSignature: "a" })).toEqual({ invitation: inv, inviter_signature: "a" });
    expect(toGroupInvitation({ invitation: inv, inviter_signature: "b" })).toEqual({ invitation: inv, inviter_signature: "b" });
  });
});
