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
import { writeSession } from "@calimero-apps/cloud";
import { installFakeCluster, type FakeCluster } from "@calimero-apps/cloud/testing";
import { getSession, resetSession, updateSession } from "../src/net/session";
import { resetTransport } from "../src/net/transport";

const manifestBytes = (pkg: string) =>
  Array.from(new TextEncoder().encode(JSON.stringify({ package: pkg })));

let cluster: FakeCluster;

beforeEach(() => {
  localStorage.clear();
  resetSession();
  resetTransport();
  cluster = installFakeCluster();
  cluster.signIn("alice");
  writeSession({ accountId: "alice", sessionToken: "t", refreshToken: "r", expiresAt: 9e9 });
  updateSession({ kind: "node", nodeUrl: "https://cloud.example" });
});
afterEach(() => {
  cluster.uninstall();
  writeSession(null);
  vi.restoreAllMocks();
});

/** The requests the app made, as `METHOD path` (reading who is signed in aside). */
const routes = () => cluster.calls.filter(([, p]) => p !== "auth/me").map(([m, p]) => `${m} ${p}`);

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
  it("installs the signed package through the cluster at the registry's newest version", async () => {
    const registry = vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      Response.json([{ appVersion: "1.2.0" }, { appVersion: "1.10.0" }, { appVersion: "2.0.0", yanked: true }]),
    );
    const id = await resolveApplicationId();
    expect(id).toBe("package:com.calimero.merraria");
    expect(registry.mock.calls.map((c) => String(c[0]))).toContain("https://apps.calimero.network/api/v2/bundles?package=com.calimero.merraria");
    expect(cluster.calls).toContainEqual(["POST", "packages/install", { package: "com.calimero.merraria", version: "1.10.0" }]);
    expect(getSession().applicationId).toBe(id);
  });

  it("installs nothing when the cluster already holds the package", async () => {
    cluster.packages.set("com.calimero.merraria", ["1.0.0"]);
    expect(await resolveApplicationId()).toBe("package:com.calimero.merraria");
    expect(routes()).toEqual(["GET packages/com.calimero.merraria"]);
  });
});

describe("listWorlds", () => {
  it("lists this account's worlds of this application, and not others", async () => {
    const mine = await createWorld("package:com.calimero.merraria", "mine", 1);
    await createWorld("package:com.other", "other", 1);
    const worlds = await listWorlds("package:com.calimero.merraria");
    expect(worlds.map((w) => w.contextId)).toEqual([mine.contextId]);
  });
});

describe("createWorld (own organization → open team → app instance)", () => {
  it("creates an organization, an OPEN team, then the app in that team", async () => {
    const res = await createWorld("package:com.calimero.merraria", "myworld", 777);
    const org = res.namespaceId;
    const team = res.groupId.slice(org.length + 1);
    expect(res.groupId).toBe(`${org}.${team}`); // a team of the world's own organization
    expect(routes()).toEqual(["POST orgs", `POST orgs/${org}/teams`, "POST apps"]);
    expect(res.contextId).toMatch(/^[0-9a-f]{64}$/);
    const body = (path: string) => cluster.calls.find(([m, p]) => m === "POST" && p === path)![2];
    expect(body("orgs")).toEqual({ name: "myworld" }); // one organization per world, named after it
    expect(body(`orgs/${org}/teams`)).toMatchObject({ name: "myworld", join: "everyone" }); // invitees reach it through the org
    const app = body("apps");
    expect(app).toMatchObject({
      package: "com.calimero.merraria",
      org,
      access: { kind: "team", team },
    });
    const init = (app as { initArgs: { name: string; seed: number; now: number } }).initArgs;
    expect(init.name).toBe("myworld");
    expect(init.seed).toBe(777);
    expect(typeof init.now).toBe("number"); // init anchors the shared day clock
  });

  it("gives every world its own organization — no reuse across worlds", async () => {
    await createWorld("package:com.calimero.merraria", "first", 1);
    await createWorld("package:com.calimero.merraria", "second", 2);
    expect(cluster.calls.filter(([m, p]) => m === "POST" && p === "orgs").map(([, , b]) => (b as { name: string }).name)).toEqual([
      "first",
      "second",
    ]);
  });
});

describe("admin error parsing", () => {
  it("surfaces the cluster's own words instead of a bare HTTP status", async () => {
    cluster.failNext("apps/", 403, "you may not join this world");
    await expect(joinWorld("ctx-x")).rejects.toThrow("you may not join this world");
  });

  it("names a world the cluster does not know", async () => {
    await expect(joinWorld("ctx-unknown")).rejects.toThrow("no such app");
  });
});

describe("joinWorld", () => {
  it("joins a world of an organization it belongs to, as its account", async () => {
    const w = await createWorld("package:com.calimero.merraria", "w", 1);
    expect(await joinWorld(w.contextId)).toBe("alice");
  });
});
