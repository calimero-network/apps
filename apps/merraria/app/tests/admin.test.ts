import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createWorld,
  joinWorld,
  listWorlds,
  packageOf,
  parseApplications,
  parseContexts,
  resolveApplicationId,
} from "../src/net/admin";
import { getSession, resetSession, updateSession } from "../src/net/session";
import { resetTransport } from "../src/net/transport";

const manifestBytes = (pkg: string) =>
  Array.from(new TextEncoder().encode(JSON.stringify({ package: pkg })));

beforeEach(() => {
  localStorage.clear();
  resetSession();
  resetTransport();
  updateSession({ kind: "node", nodeUrl: "http://node:2428" });
  localStorage.setItem("mero-tokens", JSON.stringify({ access_token: "t" }));
});
afterEach(() => vi.restoreAllMocks());

// Real `Response`s: the wire is mero-js's now, which reads bodies as text.
const okJson = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("shape-tolerant parsers", () => {
  it("parseApplications handles arrays and every wrapper key", () => {
    const app = { id: "a1" };
    expect(parseApplications([app])).toEqual([app]);
    expect(parseApplications({ apps: [app] })).toEqual([app]);
    expect(parseApplications({ applications: [app] })).toEqual([app]);
    expect(parseApplications({ items: [app] })).toEqual([app]);
    expect(parseApplications({ nope: 1 })).toEqual([]);
    expect(parseApplications(null)).toEqual([]);
  });

  it("parseContexts normalizes id field spellings", () => {
    expect(
      parseContexts({
        contexts: [
          { contextId: "c1", applicationId: "a1" },
          { id: "c2", application_id: "a2" },
          { junk: true },
        ],
      }),
    ).toEqual([
      { contextId: "c1", applicationId: "a1" },
      { contextId: "c2", applicationId: "a2" },
    ]);
    expect(parseContexts([{ id: "c3" }])).toEqual([{ contextId: "c3", applicationId: "" }]);
    expect(parseContexts(undefined)).toEqual([]);
  });

  it("packageOf finds the package wherever the node version put it", () => {
    expect(packageOf({ package: "com.x" })).toBe("com.x");
    expect(packageOf({ packageName: "com.y" })).toBe("com.y");
    expect(packageOf({ manifest: { package: "com.z" } })).toBe("com.z");
    expect(packageOf({ metadata: manifestBytes("com.m") })).toBe("com.m");
    expect(packageOf({ metadata: [1, 2, 3] })).toBe(""); // not manifest json
    expect(packageOf({})).toBe("");
  });
});

describe("resolveApplicationId", () => {
  // MRR6. The session id used to be trusted without asking the node, and a
  // remembered id survives switching nodes and reinstalling the app — the
  // node then answers every request carrying it with an opaque 500. Every
  // candidate is now checked against what the node actually has.
  it("keeps the session app id when the node has it installed", async () => {
    updateSession({ applicationId: "app-hash" });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      okJson({ data: { apps: [{ id: "app-hash", package: "com.something.else" }, { id: "mine", package: "com.calimero.merraria" }] } }),
    );
    expect(await resolveApplicationId()).toBe("app-hash"); // the hash wins over the package match
    expect(getSession().applicationId).toBe("app-hash");
  });

  it("drops a session app id this node does not know, instead of sending it (MRR6)", async () => {
    updateSession({ applicationId: "app-from-another-node" });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      okJson({ data: { apps: [{ id: "mine", package: "com.calimero.merraria" }] } }),
    );
    expect(await resolveApplicationId()).toBe("mine");
    expect(getSession().applicationId).toBe("mine"); // and not left to come back next call
  });

  it("clears a stale session id when nothing on the node matches", async () => {
    updateSession({ applicationId: "app-stale" });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      okJson({ data: { apps: [{ id: "a", package: "x" }, { id: "b", package: "y" }] } }),
    );
    expect(await resolveApplicationId()).toBeNull();
    expect(getSession().applicationId).toBeNull();
  });

  it("asks the node with the session's bearer, on the admin route", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      okJson({ data: { apps: [{ id: "mine", package: "com.calimero.merraria" }] } }),
    );
    await resolveApplicationId();
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("http://node:2428/admin-api/applications");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer t");
  });

  it("matches the installed app by package name", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      okJson({
        data: {
          apps: [
            { id: "other", package: "com.calimero.mero-blocks" },
            { id: "mine", package: "com.calimero.merraria" },
          ],
        },
      }),
    );
    expect(await resolveApplicationId()).toBe("mine");
  });

  it("falls back to a lone installed app", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      okJson({ data: { apps: [{ id: "only", package: "com.something.else" }] } }),
    );
    expect(await resolveApplicationId()).toBe("only");
  });

  it("returns null on a multi-app node with no package match", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      okJson({ data: { apps: [{ id: "a", package: "x" }, { id: "b", package: "y" }] } }),
    );
    expect(await resolveApplicationId()).toBeNull();
  });
});

describe("listWorlds", () => {
  it("filters by application id but keeps contexts that omit it", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      okJson({
        data: {
          contexts: [
            { id: "c1", applicationId: "mine" },
            { id: "c2", applicationId: "other" },
            { id: "c3" }, // old node: no applicationId field
          ],
        },
      }),
    );
    const worlds = await listWorlds("mine");
    expect(worlds.map((w) => w.contextId)).toEqual(["c1", "c3"]);
  });
});

/** route the fetch mock by URL suffix; records every request for assertions */
function mockRoutes(routes: [string, unknown][]) {
  const calls: { url: string; method: string; body: unknown }[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    calls.push({
      url,
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(init.body as string) : undefined,
    });
    for (const [suffix, data] of routes) {
      if (url.endsWith(suffix)) return okJson({ data });
    }
    return okJson({}, 404);
  });
  return calls;
}

describe("createWorld (own namespace → open subgroup → context)", () => {
  it("creates a namespace, an OPEN subgroup, then the context with groupId", async () => {
    const calls = mockRoutes([
      ["/admin-api/namespaces", { namespaceId: "ns-1" }],
      ["/admin-api/namespaces/ns-1/groups", { groupId: "grp-1" }],
      ["/admin-api/contexts", { contextId: "ctx-new", memberPublicKey: "pk-new" }],
    ]);
    const res = await createWorld("app-1", "myworld", 777);
    expect(res).toEqual({
      contextId: "ctx-new",
      memberPublicKey: "pk-new",
      namespaceId: "ns-1",
      groupId: "grp-1",
    });

    expect(calls.map((c) => `${c.method} ${c.url.replace("http://node:2428", "")}`)).toEqual([
      "POST /admin-api/namespaces",
      "POST /admin-api/namespaces/ns-1/groups",
      "POST /admin-api/contexts",
    ]);
    const nsBody = calls[0].body as Record<string, unknown>;
    expect(nsBody.applicationId).toBe("app-1");
    expect(nsBody.name).toBe("myworld"); // one namespace per world, named after it
    // The KEY SET, not just the keys we want. `CreateNamespaceApiRequest` is
    // `deny_unknown_fields`, so anything extra is a 400 for the whole create —
    // there is no such thing as a field an older node reads and this one
    // ignores. This line used to assert `alias` was PRESENT ("curb compat"),
    // which is how the fleet shipped a namespace-create that could not succeed
    // against any node since core#2338:
    //   unknown field `alias`, expected one of `applicationId`, `name`,
    //   `appKey`, `bytecodeId`
    // `upgradePolicy` (deleted in rc.21) is excluded by the same assertion.
    expect(Object.keys(nsBody).sort()).toEqual(["applicationId", "name"]);
    const groupBody = calls[1].body as Record<string, unknown>;
    expect(groupBody.groupName).toBe("myworld"); // the node's field is groupName, not name
    expect(groupBody.visibility).toBe("open"); // invitees self-join via inheritance
    const ctxBody = calls[2].body as Record<string, unknown>;
    expect(ctxBody.applicationId).toBe("app-1"); // camelCase envelope
    expect(ctxBody.groupId).toBe("grp-1"); // rc.13+ rejects contexts without one
    const params = JSON.parse(
      new TextDecoder().decode(new Uint8Array(ctxBody.initializationParams as number[])),
    );
    expect(params.name).toBe("myworld");
    expect(params.seed).toBe(777);
    expect(typeof params.now).toBe("number"); // init anchors the shared day clock
  });

  it("gives every world its own namespace — no reuse across worlds", async () => {
    const calls = mockRoutes([
      ["/admin-api/namespaces", { namespaceId: "ns-x" }],
      ["/admin-api/namespaces/ns-x/groups", { groupId: "grp-x" }],
      ["/admin-api/contexts", { contextId: "ctx-x", memberPublicKey: "pk-x" }],
    ]);
    await createWorld("app-1", "first", 1);
    await createWorld("app-1", "second", 2);
    const nsCreates = calls.filter(
      (c) => c.method === "POST" && c.url.endsWith("/admin-api/namespaces"),
    );
    expect(nsCreates).toHaveLength(2);
    expect(nsCreates.map((c) => (c.body as Record<string, unknown>).name)).toEqual([
      "first",
      "second",
    ]);
  });

  it("tolerates snake_case response fields", async () => {
    mockRoutes([
      ["/admin-api/namespaces", { namespace_id: "ns-s" }],
      ["/admin-api/namespaces/ns-s/groups", { group_id: "grp-s" }],
      ["/admin-api/contexts", { id: "ctx-s", member_public_key: "pk-s" }],
    ]);
    expect(await createWorld("a", "w", 1)).toEqual({
      contextId: "ctx-s",
      memberPublicKey: "pk-s",
      namespaceId: "ns-s",
      groupId: "grp-s",
    });
  });
});

describe("admin error parsing", () => {
  it("surfaces the node's error body instead of a bare HTTP status", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      okJson({ error: "identity not eligible for inheritance-based join" }, 403),
    );
    await expect(joinWorld("ctx-x")).rejects.toThrow(
      "identity not eligible for inheritance-based join",
    );
  });

  it("falls back to method + path + status when the body is not JSON", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("<h1>bad gateway</h1>", { status: 502, headers: { "content-type": "text/html" } }),
    );
    await expect(joinWorld("ctx-x")).rejects.toThrow(/POST .*\/join: HTTP 502/);
  });

  it("says the node is unreachable when fetch itself fails", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(joinWorld("ctx-x")).rejects.toThrow(/can't reach your node at http:\/\/node:2428/);
  });
});

describe("joinWorld", () => {
  it("joins the context and returns the identity the node owns for it", async () => {
    const calls = mockRoutes([
      ["/admin-api/contexts/ctx-1/join", {}],
      ["/admin-api/contexts/ctx-1/identities-owned", ["pk-me"]],
    ]);
    expect(await joinWorld("ctx-1")).toBe("pk-me");
    expect(calls.map((c) => c.method)).toEqual(["POST", "GET"]);
  });

  it("fails loudly when no identity exists after the join", async () => {
    mockRoutes([
      ["/admin-api/contexts/ctx-1/join", {}],
      ["/admin-api/contexts/ctx-1/identities-owned", []],
    ]);
    await expect(joinWorld("ctx-1")).rejects.toThrow(/no identity/);
  });
});
