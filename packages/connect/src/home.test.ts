import { describe, expect, it, vi } from "vitest";

import { appClusterLabel, appLabel } from "./appHost";
import {
  HOME_PACKAGE,
  clusterName,
  findHome,
  homeLinkFor,
  homeOrigin,
  homeUrl,
  showsHomeLink,
} from "./home";
import type { Target } from "./target";

const CHESS = appLabel("com.calimero.mero-chess");
const HOME = appLabel(HOME_PACKAGE);
const SERVED = `https://${CHESS}.apps.calimero.network/1.2.0/games?x=1`;

describe("appClusterLabel", () => {
  it("matches core's and mdma's resolver vector", () => {
    // crates/node/src/app_host.rs `cluster_labels_match_the_resolvers_vector`
    expect(appClusterLabel("eu-shared-1", "com.calimero.kv")).toBe(
      "zqcnu7vlgoxqnu6ar6awxsbcclqru6ry4ygt3bou7tqpimvx25va",
    );
    expect(appClusterLabel("eu-shared-2", "com.calimero.kv")).not.toBe(appClusterLabel("eu-shared-1", "com.calimero.kv"));
  });
});

describe("homeOrigin", () => {
  it("swaps the served page's label for Home's on the same apps domain", () => {
    expect(homeOrigin(SERVED)).toBe(`https://${HOME}.apps.calimero.network`);
  });

  it("uses the cluster's own host for Home when the cluster is named", () => {
    expect(homeOrigin(SERVED, "eu-shared-1")).toBe(
      `https://${appClusterLabel("eu-shared-1", HOME_PACKAGE)}.apps.calimero.network`,
    );
  });

  it("keeps the scheme and port of a merod local apps host", () => {
    expect(homeOrigin(`http://${CHESS}.localhost:2501/0.1.0/`)).toBe(`http://${HOME}.localhost:2501`);
  });

  it("gives none on a dev server, a static host or a custom domain", () => {
    expect(homeOrigin("http://localhost:5173/")).toBeNull();
    expect(homeOrigin("https://mero-chess.vercel.app/")).toBeNull();
    expect(homeOrigin("https://chess.example.com/1.0.0/")).toBeNull();
    expect(homeOrigin("not a url")).toBeNull();
    expect(homeOrigin(`file:///${CHESS}.apps.calimero.network/`)).toBeNull();
  });
});

describe("clusterName", () => {
  it("is the directory's cluster name, never a served host or a direct node", () => {
    expect(clusterName({ kind: "cloud", cluster: "eu-shared-1", minReleaseVersion: "1" })).toBe("eu-shared-1");
    expect(clusterName({ kind: "cloud", cluster: `${CHESS}.apps.calimero.network`, minReleaseVersion: "1" })).toBeNull();
    expect(
      clusterName({ kind: "cloud", cluster: "node.example.com", direct: true, nodes: ["https://node.example.com"], minReleaseVersion: "1" }),
    ).toBeNull();
    expect(clusterName({ kind: "local", nodes: ["http://127.0.0.1:2501"] })).toBeNull();
    expect(clusterName(null)).toBeNull();
  });
});

describe("homeUrl", () => {
  it("opens the org on Home's release, past the root's query-dropping redirect", () => {
    expect(homeUrl("https://h.apps.calimero.network", "0.3.0", "org/1")).toBe(
      "https://h.apps.calimero.network/0.3.0/?org=org%2F1",
    );
    expect(homeUrl("https://h.apps.calimero.network", null, null)).toBe("https://h.apps.calimero.network/");
  });
});

describe("showsHomeLink", () => {
  it("shows owners and admins in every mode", () => {
    for (const mode of ["legacy", "standalone", "shared", null] as const) {
      expect(showsHomeLink({ role: "owner", mode })).toBe(true);
      expect(showsHomeLink({ role: "admin", mode })).toBe(true);
    }
  });

  it("shows members only where the org keeps its apps apart", () => {
    expect(showsHomeLink({ role: "member", mode: "shared" })).toBe(true);
    expect(showsHomeLink({ role: "member", mode: "standalone" })).toBe(false);
    expect(showsHomeLink({ role: "member", mode: "legacy" })).toBe(false);
    expect(showsHomeLink({ role: "member", mode: null })).toBe(false);
  });

  it("never shows guests or strangers", () => {
    expect(showsHomeLink({ role: "guest", mode: "shared" })).toBe(false);
    expect(showsHomeLink({ role: null, mode: "shared" })).toBe(false);
  });
});

const TARGET: Target = { kind: "cloud", cluster: `${CHESS}.apps.calimero.network`, nodes: ["https://n1"], minReleaseVersion: "1" };

function fakeClient({
  role = "member",
  mode = "shared",
  home = true,
}: { role?: string; mode?: string | null; home?: boolean | "fails" } = {}) {
  return {
    packages: {
      get: vi.fn(async ({ package: pkg }: { package: string }) => {
        if (home === "fails") throw new Error("network");
        if (!home) throw Object.assign(new Error("no such package"), { status: 404 });
        return { package: pkg, latest: "0.3.0", versions: [{ version: "0.3.0" }] };
      }),
    },
    auth: { me: vi.fn(async () => ({ orgs: [{ orgId: "org-1", name: "Acme", role }] })) },
    orgs: { get: vi.fn(async () => ({ orgId: "org-1", ...(mode ? { mode } : {}) })) },
  };
}

type Fake = ReturnType<typeof fakeClient>;
const link = (c: Fake, org: string | null = "org-1", href = SERVED) =>
  homeLinkFor(c as unknown as Parameters<typeof homeLinkFor>[0], TARGET, org, { href });

describe("homeLinkFor", () => {
  const url = `https://${HOME}.apps.calimero.network/0.3.0/?org=org-1`;

  it("links an admin, and a member of a shared org, to the org in Home", async () => {
    expect(await link(fakeClient({ role: "admin", mode: "standalone" }))).toBe(url);
    expect(await link(fakeClient({ role: "member", mode: "shared" }))).toBe(url);
  });

  it("hides it from a member of an open org", async () => {
    expect(await link(fakeClient({ role: "member", mode: "standalone" }))).toBeNull();
    expect(await link(fakeClient({ role: "member", mode: null }))).toBeNull();
  });

  it("hides it when the cluster does not have Home, or cannot say", async () => {
    expect(await link(fakeClient({ role: "owner", home: false }))).toBeNull();
    expect(await link(fakeClient({ role: "owner", home: "fails" }))).toBeNull();
  });

  it("hides it on a dev or static host without asking the node", async () => {
    const c = fakeClient({ role: "owner" });
    expect(await link(c, "org-1", "http://localhost:5173/")).toBeNull();
    expect(await link(c, "org-1", "https://mero-chess.vercel.app/")).toBeNull();
    expect(await link(c, null)).toBeNull();
    expect(c.packages.get).not.toHaveBeenCalled();
  });

  it("asks the cluster for Home once per session", async () => {
    const c = fakeClient({ role: "owner" });
    await link(c);
    await link(c, "org-2");
    await findHome(c as unknown as Parameters<typeof findHome>[0], TARGET, { href: SERVED });
    expect(c.packages.get).toHaveBeenCalledTimes(1);
    expect(c.packages.get).toHaveBeenCalledWith({ package: HOME_PACKAGE });
  });
});
