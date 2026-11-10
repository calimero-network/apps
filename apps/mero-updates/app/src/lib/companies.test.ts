import { describe, expect, it, vi } from "vitest";

import { createCompany, listCompanies } from "./companies";

// The account of the bug: in `overworld`, which holds only a Mero Blocks world.
function client() {
  const meta: Record<string, unknown> = {};
  const apps = [
    { appId: "a1", name: "All hands", owner: "me", org: "acme", bundle: "b", package: null, version: null },
    { appId: "w1", name: "overworld", owner: "me", org: "ow", bundle: "blocks", package: "com.calimero.mero-blocks", version: null },
  ];
  return {
    me: vi.fn(async () => ({
      orgs: [
        { orgId: "acme", name: "Acme", role: "owner" },
        { orgId: "ow", name: "overworld", role: "owner" },
        { orgId: "new", name: "Fresh", role: "owner" },
      ],
    })),
    listApps: vi.fn(async (f?: { bundle?: string }) => apps.filter((a) => !f?.bundle || a.bundle === f.bundle)),
    getOrg: vi.fn(async (org: string) => ({ members: { me: "owner" }, metadata: meta[org] ?? null })),
    createOrg: vi.fn(async () => "new"),
    setCapabilities: vi.fn(async () => {}),
    setOrgMetadata: vi.fn(async (org: string, m: unknown) => {
      meta[org] = m;
    }),
  };
}

describe("companies", () => {
  it("leave out an org made for another app; a company made here is listed before it holds an audience", async () => {
    const c = client();
    expect((await listCompanies(c as never, "b")).map((r) => [r.namespaceId, r.audienceCount])).toEqual([["acme", 1]]);
    await createCompany(c as never, "Fresh", () => ({}) as never, "b");
    expect((await listCompanies(c as never, "b")).map((r) => r.namespaceId)).toEqual(["acme", "new"]);
  });
});
