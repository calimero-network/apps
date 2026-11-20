import { describe, expect, it, vi } from "vitest";
import { createRouteClient, createRoutes, publicLinkKey, Visitor } from "@calimero-network/mero-js";
import { createPublicLink, listPublicLinks, revokePublicLink, visitorSeed } from "./coreLinks";

// core's shared visitor vector (`calimero_client::visitor`, `system::tests`,
// mero-js `visitor.test.ts`). The app no longer signs a visitor's credential
// itself; this pins the mero-js it takes to the credential core expects, byte
// for byte (Ed25519 signs deterministically).
const LINK = "d4205f1ac7bb3fe43278131b6e621ebf952f0a5f51a38505327572d863c46c42";
const KEY = "fd1724385aa0c75b64fb78cd602fa1d991fdebf76b13c58ed702eac835e9f618";
const BEARER =
  "vis1.pl_token.fd1724385aa0c75b64fb78cd602fa1d991fdebf76b13c58ed702eac835e9f618.1000.9b5205e4deb4b534a612c3b03be773b60aea16192f2fb6d99496d194f2dd259173173731e56a46ec7b37cc3d2d2482fe7be5d70c0fadda54c22f5ea2b8fa4e09";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

interface Sent {
  method: string;
  path: string;
  body: Record<string, unknown> | undefined;
}

/** mero-js's generated `client.apps` over a transport that answers from `reply`, recording what it was sent. */
function fakeClient(reply: (sent: Sent, n: number) => Response) {
  const sent: Sent[] = [];
  const transport = {
    exchange: vi.fn(async (method: string, path: string, options: { bytes?: Uint8Array }) => {
      const body = options.bytes ? JSON.parse(new TextDecoder().decode(options.bytes)) : undefined;
      const s = { method, path, body };
      sent.push(s);
      return reply(s, sent.length);
    }),
  };
  const routes = createRoutes(createRouteClient(transport as unknown as Parameters<typeof createRouteClient>[0]));
  return { client: { apps: routes.apps }, sent };
}

describe("a link's visitor", () => {
  it("is mero-js's, naming the link and itself and signing the credential core expects", async () => {
    expect(await publicLinkKey("pl_token")).toBe(LINK);
    const v = await Visitor.create("pl_token", new Uint8Array(32).fill(9));
    expect(v.link).toBe(LINK);
    expect(v.publicKey).toBe(KEY);
    expect(await v.bearer(1000)).toBe(BEARER);
  });

  it("keeps one seed per browser, and works without storage", () => {
    const kept = new Map<string, string>();
    const storage = { getItem: (k: string) => kept.get(k) ?? null, setItem: (k: string, v: string) => void kept.set(k, v) };
    const first = visitorSeed(storage);
    expect(first).toHaveLength(32);
    expect(visitorSeed(storage)).toEqual(first);
    const broken = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    };
    expect(visitorSeed(broken)).toHaveLength(32);
    expect(visitorSeed(null)).toHaveLength(32);
  });
});

describe("making, listing and revoking a link at core", () => {
  it("asks the passkey for the node's challenge and answers the link and its token", async () => {
    const { client, sent } = fakeClient((_, n) =>
      n === 1
        ? json(412, { error: "CONFIRM_REQUIRED", message: "confirm", details: { challengeId: "ch1" } })
        : json(200, { link: LINK, token: "pl_token" }),
    );
    const confirm = vi.fn().mockResolvedValue({ id: "assertion" });
    const made = await createPublicLink(client, "app-1", { label: "Forms · Contact\n us", expiresAt: 1_800_000_000 }, confirm);
    expect(made).toEqual({ link: LINK, token: "pl_token" });
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(sent.map((s) => `${s.method} ${s.path}`)).toEqual([
      "POST apps/app-1/public-links",
      "POST apps/app-1/public-links",
    ]);
    expect(sent[0]?.body).toEqual({ label: "Forms · Contact us", expiresAt: 1_800_000_000, ratePerMinute: 20 });
    expect(sent[1]?.body).toMatchObject({ confirm: { challengeId: "ch1", assertion: { id: "assertion" } } });
  });

  it("throws core's refusal, with its status", async () => {
    const { client } = fakeClient(() =>
      json(403, { error: "FORBIDDEN", message: "only whoever may change the instance's access makes its public links" }),
    );
    await expect(createPublicLink(client, "app-1", {}, vi.fn())).rejects.toMatchObject({ status: 403 });
  });

  it("lists the links core keeps", async () => {
    const row = {
      link: LINK,
      label: "Forms · Contact",
      expiresAt: null,
      expired: false,
      ratePerMinute: 20,
      createdBy: "acct",
      createdAt: 1,
    };
    const { client, sent } = fakeClient(() => json(200, { links: [row] }));
    expect(await listPublicLinks(client, "app-1")).toEqual([row]);
    expect(sent[0]).toMatchObject({ method: "GET", path: "apps/app-1/public-links" });
  });

  it("revokes a link, and takes one already gone as revoked", async () => {
    const gone = fakeClient(() => json(404, { error: "NOT_FOUND", message: "no such public link" }));
    await expect(revokePublicLink(gone.client, "app-1", LINK, vi.fn())).resolves.toBeUndefined();
    expect(gone.sent[0]).toMatchObject({ method: "DELETE", path: `apps/app-1/public-links/${LINK}` });
    const refused = fakeClient(() => json(403, { error: "FORBIDDEN", message: "no" }));
    await expect(revokePublicLink(refused.client, "app-1", LINK, vi.fn())).rejects.toMatchObject({ status: 403 });
  });
});
