import { describe, expect, it, vi } from "vitest";
import type { CalimeroClient, CalimeroSession } from "@calimero-network/mero-js";
import type { KeyValueStorage } from "@calimero-apps/connect";

import { connect, describeTarget, deviceLabel, signIn, signOut, signUp, type SessionDeps } from "../src/net/session";

function memory(): KeyValueStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

const SESSION: CalimeroSession = { accountId: "acc-1", sessionToken: "s", refreshToken: "r", expiresAt: 9e12 };

function fakeClient() {
  let session: CalimeroSession | undefined;
  return {
    get session() {
      return session;
    },
    useSession: vi.fn((s: CalimeroSession) => {
      session = s;
    }),
    signIn: vi.fn(async () => {
      session = SESSION;
      return SESSION;
    }),
    signUp: vi.fn(async (_p: unknown, _name: string) => {
      session = { ...SESSION, accountId: "acc-new" };
      return session;
    }),
    signOut: vi.fn(async () => {
      session = undefined;
    }),
  };
}

function deps(env: SessionDeps["env"], storage = memory(), client = fakeClient()): SessionDeps & { client: ReturnType<typeof fakeClient> } {
  return {
    env,
    storage,
    client,
    makeClient: vi.fn(async () => client as unknown as CalimeroClient),
    passkey: () => ({}) as never,
  };
}

const LOCAL = { DEV: true, VITE_CALIMERO_TARGET: "local" };

describe("connect", () => {
  it("is a listing for a production build no cluster serves", async () => {
    const phase = await connect(deps({ DEV: false }));
    expect(phase.status).toBe("listing");
  });

  it("is unconfigured for a production build naming a cluster but no release floor", async () => {
    const phase = await connect(deps({ DEV: false, VITE_CALIMERO_CLUSTER: "eu-shared-1" }));
    expect(phase.status).toBe("unconfigured");
  });

  it("is signed out on the local nodes with nothing stored", async () => {
    const phase = await connect(deps(LOCAL));
    expect(phase.status).toBe("signed-out");
    if (phase.status !== "signed-out") return;
    expect(phase.target.kind).toBe("local");
    expect(describeTarget(phase.target)).toBe("merod local (3 nodes)");
  });

  it("restores a stored session for this app and target", async () => {
    const storage = memory();
    const first = deps(LOCAL, storage);
    const out = await connect(first);
    if (out.status !== "signed-out") throw new Error(out.status);
    const inn = await signIn(out, first);
    expect(inn.accountId).toBe("acc-1");
    // The session, and the hint that this browser has an account here (no credential).
    const keys = [...storage.data.keys()].sort();
    expect(keys).toHaveLength(2);
    expect(keys[0]).toMatch(/^calimero-account:local/);
    expect(keys[1]).toMatch(/^calimero-session:mero-blocks:local/);

    const again = await connect(deps(LOCAL, storage));
    expect(again.status).toBe("signed-in");
    if (again.status === "signed-in") expect(again.accountId).toBe("acc-1");
  });

  it("signs up with the account name, and signs out forgetting the session", async () => {
    const storage = memory();
    const d = deps(LOCAL, storage);
    const out = await connect(d);
    if (out.status !== "signed-out") throw new Error(out.status);
    const inn = await signUp(out, "alice", d);
    expect(d.client.signUp).toHaveBeenCalledWith(expect.anything(), "alice");
    expect(inn.accountId).toBe("acc-new");
    const back = await signOut(inn);
    expect(back.status).toBe("signed-out");
    // The session is gone; only the hint that an account exists here stays.
    expect([...storage.data.keys()]).toEqual([expect.stringMatching(/^calimero-account:local/)]);
  });
});

describe("deviceLabel", () => {
  it("is a stable, contract-valid label per browser", () => {
    const storage = memory();
    const a = deviceLabel(storage);
    expect(a).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
    expect(deviceLabel(storage)).toBe(a);
    expect(deviceLabel(memory())).not.toBe(a);
  });

  it("replaces a stored value the contract would refuse", () => {
    const storage = memory();
    storage.setItem("mero-blocks:device", "no/slash");
    expect(deviceLabel(storage)).toMatch(/^[a-z0-9]+$/);
  });
});
