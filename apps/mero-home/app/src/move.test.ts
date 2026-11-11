import { describe, expect, it, vi } from "vitest";
import { CalimeroError, NotFound } from "@calimero-network/mero-js";

import {
  MOVE_PROBE,
  confirmsName,
  loadMergePlan,
  mayDeleteSource,
  mergeSources,
  moveApp,
  moveEvery,
  movesSupported,
  moveTargets,
} from "./move";
import { withRoutes } from "@calimero-apps/connect/testing";

const ORGS = [
  { orgId: "acme", name: "Acme", role: "owner" },
  { orgId: "beta", name: "Beta", role: "admin" },
  { orgId: "gamma", name: "Gamma", role: "member" },
  { orgId: "delta", name: "Delta", role: "guest" },
];

describe("movesSupported", () => {
  const answering = (e: unknown) => {
    const move = vi.fn(async (_args: { app: string; toOrg: string }) => Promise.reject(e));
    return { apps: { move } } as never as { apps: { move: typeof move } } & Parameters<typeof movesSupported>[0];
  };

  it("asks to move an app no node holds", async () => {
    const client = answering(new NotFound("no such app"));
    expect(await movesSupported(client)).toBe(true);
    expect(client.apps.move).toHaveBeenCalledWith({ app: MOVE_PROBE, toOrg: "" });
  });

  it("is no on a node from before the route: a bare 404, or a 405", async () => {
    expect(await movesSupported(answering(new CalimeroError(404, "ERROR", "")))).toBe(false);
    expect(await movesSupported(answering(new CalimeroError(405, "ERROR", "")))).toBe(false);
  });

  it("is yes on any other API answer, and no when the node does not answer at all", async () => {
    expect(await movesSupported(answering(new CalimeroError(403, "FORBIDDEN", "")))).toBe(true);
    expect(await movesSupported({ apps: { move: vi.fn(async () => ({})) } } as never)).toBe(true);
    expect(await movesSupported(answering(new TypeError("fetch failed")))).toBe(false);
  });
});

describe("moving", () => {
  it("sends the target and whether people come along, with the passkey", async () => {
    const client = { apps: { move: vi.fn(async () => ({ appId: "a/1" })) } };
    const pk = { create: vi.fn(), get: vi.fn() } as never;
    await moveApp(client as never, "a/1", "beta", true, pk);
    expect(client.apps.move).toHaveBeenCalledWith(
      { app: "a/1", toOrg: "beta", bringMembers: true },
      { confirm: expect.any(Function) },
    );
  });

  it("offers only the other organizations the caller administers", () => {
    expect(moveTargets(ORGS, "acme").map((o) => o.orgId)).toEqual(["beta"]);
    expect(mergeSources(ORGS, "beta").map((o) => o.orgId)).toEqual(["acme"]);
  });

  it("moves every app in turn, one passkey each, and a refusal does not stop the rest", async () => {
    const client = {
      apps: {
        move: vi.fn(async ({ app }: { app: string }) => {
          if (app === "big") throw new CalimeroError(429, "QUOTA_EXCEEDED", "quota exceeded: file bytes");
          return { appId: app, added: [] };
        }),
      },
    };
    const passkey = vi.fn(() => ({ create: vi.fn(), get: vi.fn() }) as never);
    const seen: string[] = [];
    const out = await moveEvery(
      client as never,
      { apps: [{ app: "big", name: "Archive", package: null }, { app: "notes", name: "Notes", package: null }] },
      "acme",
      true,
      passkey,
      (o) => seen.push(o.app),
    );
    expect(seen).toEqual(["big", "notes"]);
    expect(passkey).toHaveBeenCalledTimes(2);
    expect(out[0]).toMatchObject({ app: "big", ok: false });
    expect(out[0]!.ok === false && out[0]!.error).toContain("quota exceeded");
    expect(out[1]).toMatchObject({ app: "notes", ok: true });
  });
});

describe("merging", () => {
  it("reads the source's apps, people, invites and the caller's role", async () => {
    const client = withRoutes({
      getOrg: vi.fn(async () => ({ name: "Beta", members: { me: "owner", dan: "member" }, memberMetadata: {} })),
      appsReportAll: vi.fn(async () => ({
        apps: [{ app: "x", name: "Notes", package: { package: "com.notes", version: "1.0.0" } }, { app: "y", package: null }],
      })),
      listInvites: vi.fn(async () => Promise.reject(new NotFound(""))),
    });
    const plan = await loadMergePlan(client as never, "beta", "me");
    expect(plan).toMatchObject({ source: "beta", name: "Beta", role: "owner", invites: [] });
    expect(plan.apps).toEqual([
      { app: "x", name: "Notes", package: "com.notes" },
      { app: "y", name: "y", package: null },
    ]);
    expect(plan.people.map((p) => p.account)).toEqual(["me", "dan"]);
  });

  it("lets only the owner delete the source, once it is empty, by its exact name", () => {
    expect(mayDeleteSource({ role: "owner", apps: [] })).toBe(true);
    expect(mayDeleteSource({ role: "owner", apps: [{ app: "x", name: "x", package: null }] })).toBe(false);
    expect(mayDeleteSource({ role: "admin", apps: [] })).toBe(false);
    expect(confirmsName(" Beta ", "Beta")).toBe(true);
    expect(confirmsName("beta", "Beta")).toBe(false);
    expect(confirmsName("", "")).toBe(false);
  });
});
