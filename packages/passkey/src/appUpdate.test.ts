import { describe, expect, it, vi } from "vitest";
import { CalimeroError } from "@calimero-network/mero-js";

import { parseAppUpdate, readAppUpdate, type AppUpdateClient } from "./appUpdate";

const PKG = "com.calimero.kv";
const ME = "acct-me";

/** A client whose transport answers `GET /apps/{app}/update` with `answer` (or throws it). */
function client(answer: unknown, over: Record<string, unknown> = {}) {
  const json = vi.fn(async () => {
    if (answer instanceof Error) throw answer;
    return answer;
  });
  const c = {
    session: { accountId: ME },
    transport: { json },
    apps: { get: vi.fn(async () => ({ org: "org-1" })) },
    orgs: { get: vi.fn(async () => ({ members: { [ME]: "member" }, capabilities: {}, defaultCapabilities: 0, teams: {} })) },
    auth: { me: vi.fn(async () => ({})) },
    consent: {},
    appsReportAll: vi.fn(async () => ({
      scope: { kind: "org", org: "org-1" },
      governance: { appUpgrades: "owner" },
      apps: [
        {
          app: "app-1",
          scope: { kind: "org", org: "org-1" },
          package: { package: PKG, version: "1.0.0" },
          upgradesHeldBy: "owner",
          availableVersions: ["1.1.0"],
          latestReachable: "1.1.0",
        },
      ],
    })),
    ...over,
  };
  return { client: c as unknown as AppUpdateClient, json, raw: c };
}

describe("parseAppUpdate", () => {
  it("reads core#5192's answer", () => {
    expect(
      parseAppUpdate("app-1", {
        app: "app-1",
        running: { package: PKG, version: "1.0.0" },
        available: { package: PKG, version: "1.2.0", source: "deployment" },
        mayApprove: true,
        approvers: "owner-and-admins",
      }),
    ).toEqual({
      app: "app-1",
      running: { package: PKG, version: "1.0.0" },
      available: { package: PKG, version: "1.2.0", source: "deployment" },
      mayApprove: true,
      approvers: "owner-and-admins",
      via: "route",
    });
  });

  it("never lets anyone approve an operator's upgrade, and reads a missing field as none", () => {
    const u = parseAppUpdate("app-1", { running: null, available: { package: PKG }, mayApprove: true, approvers: "operator" });
    expect(u).toMatchObject({ app: "app-1", running: null, available: null, mayApprove: false, approvers: "operator" });
  });
});

describe("readAppUpdate", () => {
  it("asks the node's route through the client's transport", async () => {
    const { client: c, json } = client({
      app: "app-1",
      running: { package: PKG, version: "1.0.0" },
      available: null,
      mayApprove: false,
      approvers: "owner-and-admins",
    });
    const u = await readAppUpdate(c, "app-1");
    expect(json).toHaveBeenCalledWith("GET", "apps/app-1/update");
    expect(u).toMatchObject({ available: null, mayApprove: false, via: "route" });
  });

  it("uses the generated method when the client has one", async () => {
    const update = vi.fn(async () => ({ app: "app-1", running: null, available: null, mayApprove: false, approvers: "managers" }));
    const { client: c, json, raw } = client(new Error("not used"));
    raw.apps = { ...raw.apps, update } as never;
    await readAppUpdate(c, "app-1");
    expect(update).toHaveBeenCalledWith({ app: "app-1" });
    expect(json).not.toHaveBeenCalled();
  });

  it("works it out from the version report on a node without the route (404), under the rule before", async () => {
    const { client: c } = client(new CalimeroError(404, "NOT_FOUND", "no such route"));
    expect(await readAppUpdate(c, "app-1")).toEqual({
      app: "app-1",
      running: { package: PKG, version: "1.0.0" },
      available: { package: PKG, version: "1.1.0", source: "release" },
      // A plain member without MANAGE_APPLICATION, not the instance's owner.
      mayApprove: false,
      approvers: "managers",
      via: "report",
    });
  });

  it("says the running release from the report when the instance is up to date there", async () => {
    const { client: c, raw } = client(new CalimeroError(404, "NOT_FOUND", "no such route"));
    (raw as Record<string, unknown>).appsReportAll = vi.fn(async () => ({
      scope: { kind: "org", org: "org-1" },
      apps: [{ app: "app-1", scope: { kind: "org", org: "org-1" }, package: { package: PKG, version: "1.1.0" }, upgradesHeldBy: "owner", availableVersions: [] }],
    }));
    expect(await readAppUpdate(c, "app-1")).toMatchObject({ running: { package: PKG, version: "1.1.0" }, available: null, via: "report" });
  });

  it("throws any other refusal for the caller to offer Try again", async () => {
    const { client: c } = client(new CalimeroError(503, "UNAVAILABLE", "busy"));
    await expect(readAppUpdate(c, "app-1")).rejects.toThrow("busy");
  });
});
