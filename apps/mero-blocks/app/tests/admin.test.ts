import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createWorld,
  listWorlds,
  packageOf,
  parseApplications,
  parseContexts,
  resolveApplicationId,
} from "../src/net/admin";
import { resetSession, updateSession } from "../src/net/session";

const manifestBytes = (pkg: string) =>
  Array.from(new TextEncoder().encode(JSON.stringify({ package: pkg })));

beforeEach(() => {
  localStorage.clear();
  resetSession();
  updateSession({ nodeUrl: "http://node:2428" });
  localStorage.setItem("mero-tokens", JSON.stringify({ access_token: "t" }));
});
afterEach(() => vi.restoreAllMocks());

const okJson = (body: unknown) => ({ ok: true, json: async () => body }) as Response;

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
  it("prefers the session app id without any network call", async () => {
    updateSession({ applicationId: "app-hash" });
    const fetchMock = vi.spyOn(globalThis, "fetch");
    expect(await resolveApplicationId()).toBe("app-hash");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("matches the installed app by package name", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      okJson({
        data: {
          apps: [
            { id: "other", package: "com.calimero.meromeet" },
            { id: "mine", package: "com.calimero.meroblocks" },
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
    return { ok: false, status: 404, json: async () => ({}) } as Response;
  });
  return calls;
}

describe("createWorld (namespace → subgroup → context)", () => {
  it("creates namespace + group, then the context with groupId", async () => {
    const calls = mockRoutes([
      ["/admin-api/namespaces/for-application/app-1", []],
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

    // no flat context creation: the sequence is ns list → ns create → group → context
    expect(calls.map((c) => `${c.method} ${c.url.replace("http://node:2428", "")}`)).toEqual([
      "GET /admin-api/namespaces/for-application/app-1",
      "POST /admin-api/namespaces",
      "POST /admin-api/namespaces/ns-1/groups",
      "POST /admin-api/contexts",
    ]);
    const nsBody = calls[1].body as Record<string, unknown>;
    expect(nsBody.applicationId).toBe("app-1");
    expect(nsBody.upgradePolicy).toBe("Automatic");
    const groupBody = calls[2].body as Record<string, unknown>;
    expect(groupBody.name).toBe("myworld");
    const ctxBody = calls[3].body as Record<string, unknown>;
    expect(ctxBody.applicationId).toBe("app-1"); // camelCase envelope
    expect(ctxBody.groupId).toBe("grp-1"); // rc.13+ rejects contexts without one
    const params = JSON.parse(
      new TextDecoder().decode(new Uint8Array(ctxBody.initializationParams as number[])),
    );
    expect(params.name).toBe("myworld");
    expect(params.seed).toBe(777);
    expect(typeof params.now).toBe("number"); // init anchors the shared day clock
  });

  it("reuses the app's existing namespace", async () => {
    const calls = mockRoutes([
      ["/admin-api/namespaces/for-application/app-1", [{ namespaceId: "ns-old" }]],
      ["/admin-api/namespaces/ns-old/groups", { groupId: "grp-2" }],
      ["/admin-api/contexts", { contextId: "ctx-2", memberPublicKey: "pk-2" }],
    ]);
    const res = await createWorld("app-1", "w2", 1);
    expect(res.namespaceId).toBe("ns-old");
    expect(res.groupId).toBe("grp-2");
    expect(calls.some((c) => c.method === "POST" && c.url.endsWith("/admin-api/namespaces"))).toBe(
      false,
    );
  });

  it("tolerates snake_case response fields", async () => {
    mockRoutes([
      ["/admin-api/namespaces/for-application/a", [{ namespace_id: "ns-s" }]],
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
