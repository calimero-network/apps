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

describe("createWorld", () => {
  it("POSTs camelCase body with init params as manifest bytes", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      okJson({ data: { contextId: "ctx-new", memberPublicKey: "pk-new" } }),
    );
    const res = await createWorld("app-1", "myworld", 777);
    expect(res).toEqual({ contextId: "ctx-new", memberPublicKey: "pk-new" });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://node:2428/admin-api/contexts");
    expect(init!.method).toBe("POST");
    expect((init!.headers as Record<string, string>).Authorization).toBe("Bearer t");
    const body = JSON.parse(init!.body as string);
    expect(body.applicationId).toBe("app-1"); // camelCase envelope
    expect(body.protocol).toBe("near");
    const params = JSON.parse(new TextDecoder().decode(new Uint8Array(body.initializationParams)));
    expect(params.name).toBe("myworld");
    expect(params.seed).toBe(777);
    expect(typeof params.now).toBe("number"); // init anchors the shared day clock
  });

  it("tolerates snake_case response fields", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      okJson({ data: { id: "ctx-s", member_public_key: "pk-s" } }),
    );
    expect(await createWorld("a", "w", 1)).toEqual({ contextId: "ctx-s", memberPublicKey: "pk-s" });
  });
});
