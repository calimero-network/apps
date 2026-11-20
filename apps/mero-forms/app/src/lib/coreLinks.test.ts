import { describe, expect, it, vi } from "vitest";
import type { CalimeroClient } from "@calimero-network/mero-js";
import {
  createPublicLink,
  LocalVisitor,
  publicLinkKey,
  revokePublicLink,
  startVisitor,
  visitorSeed,
} from "./coreLinks";

// core#5195's shared vector (`calimero_client::visitor`, `system::tests`, mero-js
// `visitor.test.ts`): Ed25519 signs deterministically, so the credential is the
// same byte for byte.
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

/** A client whose transport answers from `reply`, recording what it was sent. */
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
  const client = { transport, useApiKey: vi.fn() } as unknown as CalimeroClient & { useApiKey: ReturnType<typeof vi.fn> };
  return { client, sent };
}

describe("a link's visitor", () => {
  it("names the link and itself and signs the credential core expects", async () => {
    expect(await publicLinkKey("pl_token")).toBe(LINK);
    const v = await LocalVisitor.create("pl_token", new Uint8Array(32).fill(9));
    expect(v.link).toBe(LINK);
    expect(v.publicKey).toBe(KEY);
    expect(await v.bearer(1000)).toBe(BEARER);
  });

  it("signs a fresh credential before each request where mero-js cannot", async () => {
    const { client } = fakeClient(() => json(200, {}));
    const v = await startVisitor(client, "pl_token", new Uint8Array(32).fill(9));
    expect(v.link).toBe(LINK);
    expect(v.publicKey).toBe(KEY);
    expect(client.useApiKey).toHaveBeenCalledTimes(1);
    expect(client.useApiKey.mock.calls[0]?.[0]).toMatch(new RegExp(`^vis1\\.pl_token\\.${KEY}\\.\\d+\\.[0-9a-f]{128}$`));
    await v.fresh();
    expect(client.useApiKey).toHaveBeenCalledTimes(2);
  });

  it("leaves it to mero-js once mero-js has useVisitor", async () => {
    const { client } = fakeClient(() => json(200, {}));
    const useVisitor = vi.fn().mockResolvedValue({ link: LINK, publicKey: KEY });
    const v = await startVisitor(Object.assign(client, { useVisitor }), "pl_token", new Uint8Array(32).fill(9));
    expect(useVisitor).toHaveBeenCalledWith({ link: "pl_token", seed: new Uint8Array(32).fill(9) });
    await v.fresh();
    expect(client.useApiKey).not.toHaveBeenCalled();
    expect(v.link).toBe(LINK);
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

describe("making and revoking a link at core", () => {
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

  it("revokes a link, and takes one already gone as revoked", async () => {
    const gone = fakeClient(() => json(404, { error: "NOT_FOUND", message: "no such public link" }));
    await expect(revokePublicLink(gone.client, "app-1", LINK, vi.fn())).resolves.toBeUndefined();
    expect(gone.sent[0]).toMatchObject({ method: "DELETE", path: `apps/app-1/public-links/${LINK}` });
    const refused = fakeClient(() => json(403, { error: "FORBIDDEN", message: "no" }));
    await expect(revokePublicLink(refused.client, "app-1", LINK, vi.fn())).rejects.toMatchObject({ status: 403 });
  });
});
