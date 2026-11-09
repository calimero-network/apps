import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppsReport, ReportedApp } from "@calimero-network/mero-js";
import type { KeyValueStorage } from "@calimero-apps/connect";

import {
  UPGRADE_PENDING_KEY,
  dismissUpgrade,
  finishUpgrade,
  renderUpgradePrompt,
  startUpgrade,
  upgradeDismissed,
  upgradeOffer,
  upgradeOffers,
  upgradeReturnTo,
  watchUpgrades,
  type UpgradeClient,
} from "./upgrade";

function memoryStorage(): KeyValueStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

const ME = "acct-me";
const PKG = "com.calimero.kv";

function reported(over: Partial<ReportedApp> & { app: string }): ReportedApp {
  return {
    group: 1,
    scope: { kind: "org", org: "org-1" },
    bundle: "b",
    package: { package: PKG, version: "1.0.0" },
    publisher: null,
    upgradesHeldBy: "owner",
    lastUpgrade: null,
    approvedReleases: null,
    replicas: [],
    name: "Team store",
    availableVersions: ["1.1.0", "1.2.0"],
    ...over,
  } as ReportedApp;
}

function report(apps: ReportedApp[], over: Partial<AppsReport> = {}): AppsReport {
  return {
    scope: { kind: "org", org: "org-1" },
    governance: { releases: "owner", appUpgrades: "owner", outbound: "owner" },
    approvedReleases: null,
    clusterReleases: [],
    apps,
    next: null,
    ...over,
  };
}

/** An organization as `GET /orgs/{org}` answers it: `role` for the account, `caps` its org-wide capabilities. */
function org(role: string | null, caps?: number, teams: Record<string, unknown> = {}) {
  return {
    orgId: "org-1",
    members: role ? { [ME]: role, "acct-boss": "owner" } : { "acct-boss": "owner" },
    defaultCapabilities: 1 << 2,
    capabilities: caps === undefined ? {} : { [ME]: caps },
    teams,
  };
}

function fakeClient(over: Partial<Record<keyof UpgradeClient, unknown>> = {}) {
  return {
    session: { accountId: ME },
    getApp: vi.fn(async (app: string) => ({ appId: app, owner: "acct-boss", org: "org-1", access: { kind: "org" } })),
    appsReportAll: vi.fn(async () => report([reported({ app: "app-1" })])),
    getOrg: vi.fn(async () => org("member")),
    me: vi.fn(async () => ({ accountId: ME, orgs: [{ orgId: "org-1", role: "member" }] })),
    requestConsent: vi.fn(async () => ({ requestId: "req-1", url: "https://node.example/consent/req-1", expiresAt: 9e9 })),
    consentResult: vi.fn(async () => ({ requestId: "req-1", kind: "upgrade", status: "approved", decidedAt: 1 })),
    ...over,
  } as unknown as UpgradeClient & Record<string, ReturnType<typeof vi.fn>>;
}

describe("upgradeOffer", () => {
  it("offers the newest version to the organization's owner", async () => {
    const client = fakeClient({ getOrg: vi.fn(async () => org("owner")) });
    expect(await upgradeOffer(client, "app-1")).toEqual({
      app: "app-1",
      name: "Team store",
      current: "1.0.0",
      latest: "1.2.0",
      heldBy: "owner",
      canUpgrade: true,
    });
    expect(client.appsReportAll).toHaveBeenCalledWith("org-1");
  });

  it("an admin may upgrade too", async () => {
    const client = fakeClient({ getOrg: vi.fn(async () => org("admin")) });
    expect((await upgradeOffer(client, "app-1"))?.canUpgrade).toBe(true);
  });

  it("a plain member may not: the offer says so, and the prompt is never shown", async () => {
    const client = fakeClient();
    const offer = await upgradeOffer(client, "app-1");
    expect(offer).toMatchObject({ latest: "1.2.0", canUpgrade: false, heldBy: "owner" });
  });

  it("a member granted MANAGE_APPLICATION org-wide may", async () => {
    const client = fakeClient({ getOrg: vi.fn(async () => org("member", 1 << 4)) });
    expect((await upgradeOffer(client, "app-1"))?.canUpgrade).toBe(true);
  });

  it("a team's lead may upgrade the team's app; a guest never", async () => {
    const lead = fakeClient({
      appsReportAll: vi.fn(async () => report([reported({ app: "app-1", team: "t1" })])),
      getOrg: vi.fn(async () => org("member", undefined, { t1: { members: { [ME]: true } } })),
    });
    expect((await upgradeOffer(lead, "app-1"))?.canUpgrade).toBe(true);
    const guest = fakeClient({ getOrg: vi.fn(async () => org("guest", 1 << 4)) });
    expect((await upgradeOffer(guest, "app-1"))?.canUpgrade).toBe(false);
  });

  it("the instance's own owner may, in an organization or on their account", async () => {
    const orgApp = fakeClient({
      getApp: vi.fn(async () => ({ appId: "app-1", owner: ME, org: "org-1", access: { kind: "org" } })),
    });
    expect((await upgradeOffer(orgApp, "app-1"))?.canUpgrade).toBe(true);
    // An account's report lists its own apps only (core's `scope_report`).
    const own = fakeClient({
      getApp: vi.fn(async () => ({ appId: "app-1", owner: ME, org: null, access: { kind: "owner" } })),
      appsReportAll: vi.fn(async () =>
        report([reported({ app: "app-1", scope: { kind: "account" } })], { scope: { kind: "account" } }),
      ),
    });
    expect((await upgradeOffer(own, "app-1"))?.canUpgrade).toBe(true);
    expect(own.appsReportAll).toHaveBeenCalledWith(null);
  });

  it("held by the publisher: offered to nobody here, the org's owner included", async () => {
    const client = fakeClient({
      getOrg: vi.fn(async () => org("owner")),
      appsReportAll: vi.fn(async () => report([reported({ app: "app-1", upgradesHeldBy: "publisher" as never })])),
    });
    expect(await upgradeOffer(client, "app-1")).toMatchObject({ heldBy: "publisher", canUpgrade: false });
  });

  it("held by the operator (cluster governance): offered to nobody here", async () => {
    const byReport = fakeClient({
      getOrg: vi.fn(async () => org("owner")),
      appsReportAll: vi.fn(async () => report([reported({ app: "app-1", upgradesHeldBy: "operator" })])),
    });
    expect(await upgradeOffer(byReport, "app-1")).toMatchObject({ heldBy: "operator", canUpgrade: false });
    // An older node's report that says `owner` per app still names the cluster's governance.
    const byGovernance = fakeClient({
      getOrg: vi.fn(async () => org("owner")),
      appsReportAll: vi.fn(async () =>
        report([reported({ app: "app-1" })], {
          governance: { releases: "owner", appUpgrades: "operator", outbound: "owner" },
        }),
      ),
    });
    expect(await upgradeOffer(byGovernance, "app-1")).toMatchObject({ heldBy: "operator", canUpgrade: false });
  });

  it("a frontend-only release (the same WASM) is an upgrade like any other", async () => {
    const client = fakeClient({
      getOrg: vi.fn(async () => org("owner")),
      appsReportAll: vi.fn(async () =>
        report([reported({ app: "app-1", bundle: "same-wasm", package: { package: PKG, version: "1.0.0" }, availableVersions: ["1.0.1"] })]),
      ),
    });
    expect(await upgradeOffer(client, "app-1")).toMatchObject({ current: "1.0.0", latest: "1.0.1", canUpgrade: true });
  });

  it("nothing when the instance is up to date", async () => {
    const client = fakeClient({
      getOrg: vi.fn(async () => org("owner")),
      appsReportAll: vi.fn(async () => report([reported({ app: "app-1", availableVersions: [] })])),
    });
    expect(await upgradeOffer(client, "app-1")).toBeNull();
  });

  it("nothing when the report is missing, cannot be read, or runs a development bundle", async () => {
    const missing = fakeClient({ appsReportAll: vi.fn(async () => report([])) });
    expect(await upgradeOffer(missing, "app-1")).toBeNull();
    const refused = fakeClient({ appsReportAll: vi.fn(async () => Promise.reject(new Error("404"))) });
    expect(await upgradeOffer(refused, "app-1")).toBeNull();
    const old = fakeClient({ appsReportAll: vi.fn(async () => report([reported({ app: "app-1", availableVersions: undefined })])) });
    expect(await upgradeOffer(old, "app-1")).toBeNull();
    const dev = fakeClient({ appsReportAll: vi.fn(async () => report([reported({ app: "app-1", package: null })])) });
    expect(await upgradeOffer(dev, "app-1")).toBeNull();
  });

  it("hides rather than guesses when the organization cannot be read", async () => {
    const client = fakeClient({ getOrg: vi.fn(async () => Promise.reject(new Error("404"))) });
    expect((await upgradeOffer(client, "app-1"))?.canUpgrade).toBe(false);
  });
});

describe("upgradeOffers", () => {
  it("reads the account's own apps and each organization's, of this package only", async () => {
    const client = fakeClient({
      me: vi.fn(async () => ({ orgs: [{ orgId: "org-1", role: "owner" }] })),
      appsReportAll: vi.fn(async (scope: string | null) =>
        scope === null
          ? report([reported({ app: "mine", scope: { kind: "account" }, name: "Mine" })], { scope: { kind: "account" } })
          : report([
              reported({ app: "team", name: "Team" }),
              reported({ app: "other", package: { package: "com.other", version: "1.0.0" } }),
            ]),
      ),
    });
    const offers = await upgradeOffers(client, { package: PKG });
    expect(offers.map((o) => [o.app, o.canUpgrade])).toEqual([
      ["mine", true],
      ["team", true],
    ]);
    // The org owner's role said it: the organization is not read.
    expect(client.getOrg).not.toHaveBeenCalled();
  });
});

describe("startUpgrade", () => {
  it("asks for the upgrade's consent with the app, version and returnTo, remembers it, then opens the page", async () => {
    const client = fakeClient();
    const storage = memoryStorage();
    const navigate = vi.fn();
    await startUpgrade(client, "app-1", "1.2.0", "https://kv.apps.example/1.0.0/", { navigate, storage, from: "1.0.0" });
    expect(client.requestConsent).toHaveBeenCalledWith({
      kind: "upgrade",
      subject: { app: "app-1", toVersion: "1.2.0" },
      returnTo: "https://kv.apps.example/1.0.0/",
    });
    expect(navigate).toHaveBeenCalledWith("https://node.example/consent/req-1");
    expect(JSON.parse(storage.getItem(UPGRADE_PENDING_KEY)!)).toMatchObject({
      requestId: "req-1",
      app: "app-1",
      version: "1.2.0",
      from: "1.0.0",
    });
  });

  it("does not navigate when the node refuses the request", async () => {
    const client = fakeClient({ requestConsent: vi.fn(async () => Promise.reject(new Error("403 FORBIDDEN"))) });
    const navigate = vi.fn();
    await expect(startUpgrade(client, "app-1", "1.2.0", "https://x/", { navigate, storage: memoryStorage() })).rejects.toThrow(
      "403",
    );
    expect(navigate).not.toHaveBeenCalled();
  });

  it("returnTo is this page without a fragment or a previous consent's answer", () => {
    expect(upgradeReturnTo("https://kv.apps.example/1.0.0/notes?x=1&request_id=r&result=approved#top")).toBe(
      "https://kv.apps.example/1.0.0/notes?x=1",
    );
  });
});

describe("finishUpgrade", () => {
  const back = "https://kv.apps.example/1.0.0/?request_id=req-1&result=approved";

  it("confirms the decision with the node and forgets the pending request", async () => {
    const storage = memoryStorage();
    storage.setItem(UPGRADE_PENDING_KEY, JSON.stringify({ requestId: "req-1", app: "app-1", version: "1.2.0", from: "1.0.0", at: Date.now() }));
    const client = fakeClient();
    expect(await finishUpgrade(client, back, storage)).toMatchObject({
      status: "approved",
      app: "app-1",
      version: "1.2.0",
      href: "https://kv.apps.example/1.0.0/",
    });
    expect(client.consentResult).toHaveBeenCalledWith("req-1");
    expect(storage.getItem(UPGRADE_PENDING_KEY)).toBeNull();
  });

  it("says declined when the node says so, whatever the URL claims", async () => {
    const storage = memoryStorage();
    storage.setItem(UPGRADE_PENDING_KEY, JSON.stringify({ requestId: "req-1", app: "app-1", version: "1.2.0", at: Date.now() }));
    const client = fakeClient({
      consentResult: vi.fn(async () => ({ requestId: "req-1", kind: "upgrade", status: "declined", decidedAt: 1 })),
    });
    expect((await finishUpgrade(client, back, storage))?.status).toBe("declined");
  });

  it("leaves a return it did not start alone", async () => {
    const client = fakeClient();
    expect(await finishUpgrade(client, back, memoryStorage())).toBeNull();
    expect(await finishUpgrade(client, "https://kv.apps.example/1.0.0/", memoryStorage())).toBeNull();
    expect(client.consentResult).not.toHaveBeenCalled();
  });
});

describe("dismissal", () => {
  it("is remembered per app and version", () => {
    const storage = memoryStorage();
    dismissUpgrade(storage, "app-1", "1.2.0");
    expect(upgradeDismissed(storage, "app-1", "1.2.0")).toBe(true);
    expect(upgradeDismissed(storage, "app-1", "1.3.0")).toBe(false);
    expect(upgradeDismissed(storage, "app-2", "1.2.0")).toBe(false);
  });

  it("survives storage that throws: the prompt is then only hidden for this page", () => {
    const throwing: KeyValueStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    expect(() => dismissUpgrade(throwing, "app-1", "1.2.0")).not.toThrow();
    expect(upgradeDismissed(throwing, "app-1", "1.2.0")).toBe(false);
  });
});

describe("renderUpgradePrompt", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("says the version, what runs now, and offers Update and Not now", () => {
    const update = vi.fn();
    const later = vi.fn();
    const el = renderUpgradePrompt(
      document.body,
      { app: "app-1", name: "Team store", current: "1.0.0", latest: "1.2.0", heldBy: "owner", canUpgrade: true },
      { appName: "KV Store", onUpdate: update, onLater: later },
    );
    expect(el.textContent).toContain("Version 1.2.0 of KV Store is available (you run 1.0.0).");
    expect(el.getAttribute("role")).toBe("region");
    (el.querySelector("[data-testid=upgrade-update]") as HTMLElement).click();
    expect(update).toHaveBeenCalled();
    (el.querySelector("[data-testid=upgrade-later]") as HTMLElement).click();
    expect(later).toHaveBeenCalled();
  });
});

describe("watchUpgrades", () => {
  const flush = () => new Promise((r) => setTimeout(r, 0));
  let storage: ReturnType<typeof memoryStorage>;
  beforeEach(() => {
    storage = memoryStorage();
  });
  afterEach(() => {
    document.body.innerHTML = "";
  });

  const ownerClient = () =>
    fakeClient({
      me: vi.fn(async () => ({ orgs: [{ orgId: "org-1", role: "owner" }] })),
      appsReportAll: vi.fn(async (scope: string | null) => (scope === null ? report([]) : report([reported({ app: "app-1" })]))),
    });

  it("shows the prompt to someone who may upgrade; Not now hides it for that version for good", async () => {
    const client = ownerClient();
    const stop = watchUpgrades({ client, package: PKG, appName: "KV Store", storage, href: "https://kv/1.0.0/" });
    await vi.waitFor(() => expect(document.querySelector("[data-testid=upgrade-prompt]")).not.toBeNull());
    (document.querySelector("[data-testid=upgrade-later]") as HTMLElement).click();
    expect(document.querySelector("[data-testid=upgrade-prompt]")).toBeNull();
    stop();
    const again = watchUpgrades({ client: ownerClient(), package: PKG, appName: "KV Store", storage, href: "https://kv/1.0.0/" });
    await flush();
    await flush();
    expect(document.querySelector("[data-testid=upgrade-prompt]")).toBeNull();
    again();
  });

  it("never shows it to a member who may not upgrade", async () => {
    const client = fakeClient();
    const stop = watchUpgrades({ client, package: PKG, appName: "KV Store", storage, href: "https://kv/1.0.0/" });
    await vi.waitFor(() => expect(client.getOrg).toHaveBeenCalled());
    await flush();
    expect(document.querySelector("[data-testid=upgrade-prompt]")).toBeNull();
    stop();
  });

  it("Update sends the person to the consent page", async () => {
    const client = ownerClient();
    const navigate = vi.fn();
    const stop = watchUpgrades({ client, package: PKG, appName: "KV Store", storage, href: "https://kv/1.0.0/#x", navigate });
    await vi.waitFor(() => expect(document.querySelector("[data-testid=upgrade-update]")).not.toBeNull());
    (document.querySelector("[data-testid=upgrade-update]") as HTMLElement).click();
    await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith("https://node.example/consent/req-1"));
    expect(client.requestConsent).toHaveBeenCalledWith(
      expect.objectContaining({ subject: { app: "app-1", toVersion: "1.2.0" }, returnTo: "https://kv/1.0.0/" }),
    );
    stop();
  });

  it("back from an approved consent: says it is updated, and offers nothing more", async () => {
    storage.setItem(UPGRADE_PENDING_KEY, JSON.stringify({ requestId: "req-1", app: "app-1", version: "1.2.0", from: "1.0.0", at: Date.now() }));
    const client = fakeClient({
      me: vi.fn(async () => ({ orgs: [{ orgId: "org-1", role: "owner" }] })),
      getOrg: vi.fn(async () => org("owner")),
      appsReportAll: vi.fn(async () =>
        report([reported({ app: "app-1", package: { package: PKG, version: "1.2.0" }, availableVersions: [] })]),
      ),
    });
    const replaceUrl = vi.fn();
    const stop = watchUpgrades({
      client,
      package: PKG,
      appName: "KV Store",
      storage,
      href: "https://kv/1.0.0/?request_id=req-1&result=approved",
      replaceUrl,
    });
    await vi.waitFor(() => expect(document.querySelector("[data-testid=upgrade-notice]")).not.toBeNull());
    expect(document.querySelector("[data-testid=upgrade-notice]")!.textContent).toContain("KV Store is updated to version 1.2.0");
    expect(replaceUrl).toHaveBeenCalledWith("https://kv/1.0.0/");
    expect(document.querySelector("[data-testid=upgrade-prompt]")).toBeNull();
    stop();
    expect(document.querySelector("[data-testid=upgrade-notice]")).toBeNull();
  });

  const SERVED = `https://${"a".repeat(52)}.apps.calimero.network`;
  const approvedClient = (runs: string) =>
    fakeClient({
      me: vi.fn(async () => ({ orgs: [{ orgId: "org-1", role: "owner" }] })),
      getOrg: vi.fn(async () => org("owner")),
      appsReportAll: vi.fn(async () =>
        report([reported({ app: "app-1", package: { package: PKG, version: runs }, availableVersions: [] })]),
      ),
    });

  it("back from an approved consent on a served page: loads the new release's frontend in the same place, which says so", async () => {
    storage.setItem(UPGRADE_PENDING_KEY, JSON.stringify({ requestId: "req-1", app: "app-1", version: "1.2.0", from: "1.0.0", at: Date.now() }));
    const navigate = vi.fn();
    const stop = watchUpgrades({
      client: approvedClient("1.2.0"),
      package: PKG,
      appName: "KV Store",
      storage,
      href: `${SERVED}/1.0.0/deals/7?tab=a&request_id=req-1&result=approved`,
      navigate,
      replaceUrl: () => {},
    });
    await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith(`${SERVED}/app/app-1/deals/7?tab=a`));
    expect(document.querySelector("[data-testid=upgrade-notice]")).toBeNull();
    stop();
    // The page `/app/app-1/` lands on: the 1.2.0 frontend.
    const after = watchUpgrades({
      client: approvedClient("1.2.0"),
      package: PKG,
      appName: "KV Store",
      storage,
      href: `${SERVED}/1.2.0/deals/7?tab=a`,
      navigate,
    });
    await vi.waitFor(() => expect(document.querySelector("[data-testid=upgrade-notice]")).not.toBeNull());
    expect(document.querySelector("[data-testid=upgrade-notice]")!.textContent).toContain("KV Store is updated to version 1.2.0.");
    expect(document.querySelector("[data-testid=upgrade-reload]")).toBeNull();
    expect(navigate).toHaveBeenCalledTimes(1);
    after();
  });

  it("back from an approved consent that did not take: says what still runs, and moves nowhere", async () => {
    storage.setItem(UPGRADE_PENDING_KEY, JSON.stringify({ requestId: "req-1", app: "app-1", version: "1.2.0", from: "1.0.0", at: Date.now() }));
    const navigate = vi.fn();
    const client = approvedClient("1.0.0");
    (client.appsReportAll as ReturnType<typeof vi.fn>).mockResolvedValue(
      report([reported({ app: "app-1", package: { package: PKG, version: "1.0.0" }, availableVersions: ["1.2.0"] })]),
    );
    const stop = watchUpgrades({
      client,
      package: PKG,
      appName: "KV Store",
      storage,
      href: `${SERVED}/1.0.0/?request_id=req-1&result=approved`,
      navigate,
      replaceUrl: () => {},
    });
    await vi.waitFor(() => expect(document.querySelector("[data-testid=upgrade-notice]")).not.toBeNull());
    expect(document.querySelector("[data-testid=upgrade-notice]")!.textContent).toContain("still runs version 1.0.0");
    expect(navigate).not.toHaveBeenCalled();
    stop();
  });

  it("back from a declined consent: says so, and the prompt can come back later", async () => {
    storage.setItem(UPGRADE_PENDING_KEY, JSON.stringify({ requestId: "req-1", app: "app-1", version: "1.2.0", at: Date.now() }));
    const client = ownerClient();
    (client.consentResult as ReturnType<typeof vi.fn>).mockResolvedValue({ requestId: "req-1", status: "declined" });
    const stop = watchUpgrades({
      client,
      package: PKG,
      appName: "KV Store",
      storage,
      href: "https://kv/1.0.0/?request_id=req-1&result=declined",
      replaceUrl: () => {},
    });
    await vi.waitFor(() => expect(document.querySelector("[data-testid=upgrade-notice]")).not.toBeNull());
    expect(document.querySelector("[data-testid=upgrade-notice]")!.textContent).toContain("was not approved");
    stop();
  });

  it("one prompt for a package, however many watchers mount", async () => {
    const a = watchUpgrades({ client: ownerClient(), package: PKG, appName: "KV Store", storage, href: "https://kv/" });
    const b = watchUpgrades({ client: ownerClient(), package: PKG, appName: "KV Store", storage, href: "https://kv/" });
    await vi.waitFor(() => expect(document.querySelector("[data-testid=upgrade-prompt]")).not.toBeNull());
    await flush();
    expect(document.querySelectorAll("[data-testid=upgrade-prompt]")).toHaveLength(1);
    a();
    b();
  });

  it("a client that cannot report shows nothing and throws nothing", async () => {
    const stop = watchUpgrades({ client: {} as UpgradeClient, package: PKG, appName: "KV Store", storage, href: "https://kv/" });
    await flush();
    await flush();
    expect(document.body.innerHTML).toBe("");
    stop();
  });
});
