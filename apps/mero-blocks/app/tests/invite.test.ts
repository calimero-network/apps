import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  decodeInvite,
  encodeInvite,
  namespaceIdOfInvite,
  WorldInvitePayload,
} from "../src/net/inviteCodec";
import { acceptWorldInvite, createWorldInvite } from "../src/net/admin";
import { getSession, resetSession, updateSession } from "../src/net/session";

const okJson = (body: unknown) => ({ ok: true, json: async () => body }) as Response;

const SIGNED = {
  invitation: {
    inviterIdentity: [1, 2],
    groupId: [0xab, 0xcd, 0x01],
    expirationTimestamp: 999,
    secretSalt: [9],
  },
  inviterSignature: "sig-base58",
};

const PAYLOAD: WorldInvitePayload = {
  invitation: SIGNED,
  groupAlias: "overworld",
  contextId: "ctx-77",
  groupId: "grp-77",
};

beforeEach(() => {
  localStorage.clear();
  resetSession();
  updateSession({ nodeUrl: "http://node:2428", applicationId: "app-1" });
  localStorage.setItem("mero-tokens", JSON.stringify({ access_token: "t" }));
});
afterEach(() => vi.restoreAllMocks());

describe("invite codec", () => {
  it("roundtrips deflate+base58", () => {
    const code = encodeInvite(PAYLOAD);
    expect(code).toMatch(/^[1-9A-HJ-NP-Za-km-z]+$/); // base58 alphabet
    expect(decodeInvite(code)).toEqual(PAYLOAD);
  });

  it("accepts raw JSON and {data:...} wrappers", () => {
    expect(decodeInvite(JSON.stringify(PAYLOAD))).toEqual(PAYLOAD);
    expect(decodeInvite(JSON.stringify({ data: PAYLOAD }))).toEqual(PAYLOAD);
  });

  it("accepts a bare curb-style signed invitation", () => {
    const decoded = decodeInvite(JSON.stringify(SIGNED));
    expect(decoded).toEqual({ invitation: SIGNED });
  });

  it("rejects garbage", () => {
    expect(decodeInvite("")).toBeNull();
    expect(decodeInvite("not an invite")).toBeNull();
    expect(decodeInvite("{}")).toBeNull();
  });

  it("extracts the namespace id from group id bytes (and string/snake forms)", () => {
    expect(namespaceIdOfInvite(PAYLOAD)).toBe("abcd01");
    const str = { invitation: { invitation: { groupId: "deadbeef" }, inviterSignature: "s" } };
    expect(namespaceIdOfInvite(str)).toBe("deadbeef");
    const snake = { invitation: { invitation: { group_id: [0x00, 0xff] }, inviterSignature: "s" } };
    expect(namespaceIdOfInvite(snake)).toBe("00ff");
  });
});

/** fail with a node-style {"error": …} body, like the real admin API */
function mockRoutes(routes: [string, unknown][], failing: [string, string][] = []) {
  const calls: { url: string; method: string; body: unknown }[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    calls.push({
      url,
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(init.body as string) : undefined,
    });
    for (const [suffix, error] of failing) {
      if (url.endsWith(suffix))
        return { ok: false, status: 403, json: async () => ({ error }) } as Response;
    }
    for (const [suffix, data] of routes) {
      if (url.endsWith(suffix)) return okJson({ data });
    }
    return { ok: false, status: 404, json: async () => ({}) } as Response;
  });
  return calls;
}

describe("acceptWorldInvite", () => {
  it("joins namespace → subgroup (inheritance) → context, verifies the identity, stores the session", async () => {
    const calls = mockRoutes([
      ["/admin-api/namespaces/abcd01/join", { groupId: "abcd01", memberIdentity: "me" }],
      ["/admin-api/groups/grp-77/join-via-inheritance", {}],
      ["/admin-api/contexts/ctx-77/join", {}],
      ["/admin-api/contexts/ctx-77/identities-owned", ["pk-me"]],
    ]);
    const contextId = await acceptWorldInvite(encodeInvite(PAYLOAD));
    expect(contextId).toBe("ctx-77");
    expect(calls.map((c) => c.url.replace("http://node:2428", ""))).toEqual([
      "/admin-api/namespaces/abcd01/join",
      "/admin-api/groups/grp-77/join-via-inheritance",
      "/admin-api/contexts/ctx-77/join",
      "/admin-api/contexts/ctx-77/identities-owned",
    ]);
    expect((calls[0].body as Record<string, unknown>).invitation).toEqual(SIGNED);
    expect(getSession().contextId).toBe("ctx-77");
    expect(getSession().namespaceId).toBe("abcd01");
    expect(getSession().groupId).toBe("grp-77");
    expect(getSession().executorPublicKey).toBe("pk-me"); // rpc executor for the world
  });

  it("tolerates already-a-member on the namespace join", async () => {
    mockRoutes(
      [
        ["/admin-api/groups/grp-77/join-via-inheritance", {}],
        ["/admin-api/contexts/ctx-77/join", {}],
        ["/admin-api/contexts/ctx-77/identities-owned", ["pk-me"]],
      ],
      [["/admin-api/namespaces/abcd01/join", "already a member"]],
    );
    expect(await acceptWorldInvite(encodeInvite(PAYLOAD))).toBe("ctx-77");
  });

  it("retries the subgroup join once after syncing the namespace", async () => {
    let inheritanceCalls = 0;
    const calls: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input).replace("http://node:2428", "");
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (url.endsWith("/join-via-inheritance")) {
        inheritanceCalls++;
        if (inheritanceCalls === 1)
          return { ok: false, status: 404, json: async () => ({ error: "group not found" }) } as Response;
        return okJson({ data: {} });
      }
      if (url.endsWith("/identities-owned")) return okJson({ data: ["pk-me"] });
      return okJson({ data: {} });
    });
    expect(await acceptWorldInvite(encodeInvite(PAYLOAD))).toBe("ctx-77");
    expect(inheritanceCalls).toBe(2);
    expect(calls).toContain("POST /admin-api/groups/abcd01/sync");
  });

  it("surfaces a friendly message when the world's subgroup is not open", async () => {
    mockRoutes(
      [
        ["/admin-api/namespaces/abcd01/join", {}],
        ["/admin-api/groups/abcd01/sync", {}],
      ],
      [
        [
          "/admin-api/groups/grp-77/join-via-inheritance",
          "identity not eligible for inheritance-based join",
        ],
      ],
    );
    await expect(acceptWorldInvite(encodeInvite(PAYLOAD))).rejects.toThrow(
      /not open to invited players/,
    );
    expect(getSession().contextId).toBeNull(); // never half-enters the world
  });

  it("fails when the context join leaves us without an identity", async () => {
    mockRoutes([
      ["/admin-api/namespaces/abcd01/join", {}],
      ["/admin-api/groups/grp-77/join-via-inheritance", {}],
      ["/admin-api/contexts/ctx-77/join", {}],
      ["/admin-api/contexts/ctx-77/identities-owned", []],
    ]);
    await expect(acceptWorldInvite(encodeInvite(PAYLOAD))).rejects.toThrow(/no identity/);
    expect(getSession().contextId).toBeNull();
  });

  it("discovers the context for curb-style payloads without one", async () => {
    const bare: WorldInvitePayload = { invitation: SIGNED, groupId: "grp-9" };
    mockRoutes([
      ["/admin-api/namespaces/abcd01/join", {}],
      ["/admin-api/groups/grp-9/join-via-inheritance", {}],
      ["/admin-api/groups/grp-9/contexts", { contexts: [{ contextId: "ctx-found" }] }],
      ["/admin-api/contexts/ctx-found/join", {}],
      ["/admin-api/contexts/ctx-found/identities-owned", ["pk-me"]],
    ]);
    expect(await acceptWorldInvite(encodeInvite(bare))).toBe("ctx-found");
  });

  it("rejects invalid codes without touching the network", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    await expect(acceptWorldInvite("definitely not a code")).rejects.toThrow(/valid invite/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("createWorldInvite", () => {
  it("mints a namespace invitation and pins the world's ids into the payload", async () => {
    updateSession({ contextId: "ctx-77", namespaceId: "ns-1", groupId: "grp-77" });
    const calls = mockRoutes([
      ["/admin-api/groups/grp-77", { subgroupVisibility: "open" }],
      ["/admin-api/namespaces/ns-1/invite", { invitation: SIGNED, groupName: "overworld" }],
    ]);
    const code = await createWorldInvite();
    const payload = decodeInvite(code)!;
    expect(payload.invitation).toEqual(SIGNED);
    expect(payload.contextId).toBe("ctx-77");
    expect(payload.groupId).toBe("grp-77");
    expect(payload.groupAlias).toBe("overworld");
    // already open — no visibility flip needed
    expect(calls.some((c) => c.method === "PUT")).toBe(false);
  });

  it("flips a legacy restricted world open before minting", async () => {
    updateSession({ contextId: "ctx-77", namespaceId: "ns-1", groupId: "grp-77" });
    const calls = mockRoutes([
      ["/admin-api/groups/grp-77", { subgroupVisibility: "restricted" }],
      ["/admin-api/groups/grp-77/settings/subgroup-visibility", {}],
      ["/admin-api/namespaces/ns-1/invite", { invitation: SIGNED }],
    ]);
    await createWorldInvite();
    const flip = calls.find((c) => c.method === "PUT");
    expect(flip?.url).toContain("/groups/grp-77/settings/subgroup-visibility");
    expect(flip?.body).toEqual({ subgroupVisibility: "open" });
  });

  it("resolves namespace + group when the session lacks them (joined via picker)", async () => {
    updateSession({ contextId: "ctx-77" });
    mockRoutes([
      ["/admin-api/contexts/ctx-77/group", "grp-77"],
      ["/admin-api/namespaces/for-application/app-1", [{ namespaceId: "ns-1" }]],
      ["/admin-api/namespaces/ns-1/groups", [{ groupId: "grp-77", name: "overworld" }]],
      ["/admin-api/groups/grp-77", { subgroupVisibility: "open" }],
      ["/admin-api/namespaces/ns-1/invite", { invitation: SIGNED }],
    ]);
    const payload = decodeInvite(await createWorldInvite())!;
    expect(payload.contextId).toBe("ctx-77");
    expect(payload.groupId).toBe("grp-77");
    expect(getSession().namespaceId).toBe("ns-1"); // cached for the next invite
  });

  it("does not trust a namespace cached from a DIFFERENT world", async () => {
    // switched from another world: contextId updated, coordinates cleared by
    // the picker — the invite must resolve ctx-77's own namespace
    updateSession({ contextId: "ctx-77", namespaceId: null, groupId: null });
    const calls = mockRoutes([
      ["/admin-api/contexts/ctx-77/group", "grp-77"],
      ["/admin-api/namespaces/for-application/app-1", [{ namespaceId: "ns-77" }]],
      ["/admin-api/namespaces/ns-77/groups", [{ groupId: "grp-77" }]],
      ["/admin-api/groups/grp-77", { subgroupVisibility: "open" }],
      ["/admin-api/namespaces/ns-77/invite", { invitation: SIGNED }],
    ]);
    await createWorldInvite();
    expect(calls.some((c) => c.url.endsWith("/admin-api/namespaces/ns-77/invite"))).toBe(true);
    expect(getSession().namespaceId).toBe("ns-77");
  });

  it("refuses when offline", async () => {
    await expect(createWorldInvite()).rejects.toThrow(/not in a shared world/);
  });
});
