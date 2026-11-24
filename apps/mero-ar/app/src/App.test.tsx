import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { CalimeroClient, CalimeroSession } from "@calimero-network/mero-js";
import { SessionStore, resolveTarget, type KeyValueStorage } from "@calimero-apps/connect";
import { b64url, captureNativeSignIn, dropNativeSignIn } from "@calimero-apps/passkey/native";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { APP, type SessionDeps } from "./session";

class Memory implements KeyValueStorage {
  readonly items = new Map<string, string>();
  getItem(k: string) {
    return this.items.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.items.set(k, v);
  }
  removeItem(k: string) {
    this.items.delete(k);
  }
}

const ENV = { DEV: true, VITE_CALIMERO_BUNDLE: "bundle-hash" };
const STORED: CalimeroSession = { accountId: "acct-stored", sessionToken: "s0", refreshToken: "r0", expiresAt: 9e12 };
const FRESH: CalimeroSession = { accountId: "acct-fresh", sessionToken: "s1", refreshToken: "r1", expiresAt: 9e12 };
const NODE = "http://127.0.0.1:2501";

function fakeClient() {
  let session: CalimeroSession | undefined;
  return {
    nodeUrl: NODE,
    nodes: [NODE, "http://127.0.0.1:2502"],
    get session() {
      return session;
    },
    useSession: vi.fn((s: CalimeroSession) => {
      session = s;
    }),
    signIn: vi.fn(async () => {
      session = FRESH;
      return FRESH;
    }),
    signOut: vi.fn(async () => {
      session = undefined;
    }),
    auth: { me: async () => ({}), signupPolicy: async () => ({ policy: "open" }) },
    verification: () => undefined,
    verify: async () => undefined,
  };
}

function deps(storage: KeyValueStorage, client = fakeClient()): SessionDeps {
  return {
    env: ENV,
    makeClient: async () => client as unknown as CalimeroClient,
    passkey: () => ({}) as never,
    storage,
  };
}

/** A request the iOS app would make: a fresh P-256 key and a state. */
async function nativeRequest() {
  const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const key = b64url(new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey)));
  const state = "s".repeat(24);
  captureNativeSignIn({ hash: `#native-sign-in&state=${state}&key=${key}`, pathname: "/", search: "" }, sessionStorage, {
    replaceState: () => {},
  });
  return state;
}

afterEach(() => {
  cleanup();
  dropNativeSignIn();
});

describe("Mero AR's served page", () => {
  it("signs the iOS app in fresh and hands the session back to mero-ar://signed-in", async () => {
    const storage = new Memory();
    new SessionStore(APP, resolveTarget(ENV), storage).save(STORED);
    const state = await nativeRequest();
    const go = vi.fn();
    const client = fakeClient();
    render(<App deps={deps(storage, client)} nativeSignIn go={go} />);

    // The browser's own session is not what the app gets: it signs in again.
    fireEvent.click(await screen.findByTestId("signin-passkey"));
    await waitFor(() => expect(go).toHaveBeenCalledTimes(1));
    const url = new URL(String(go.mock.calls[0]?.[0]));
    expect(`${url.protocol}//${url.host}${url.pathname}`).toBe("mero-ar://signed-in");
    const fragment = new URLSearchParams(url.hash.slice(1));
    expect(fragment.get("state")).toBe(state);
    expect(fragment.get("box")).toMatch(/^[A-Za-z0-9_-]{100,}$/);
    expect(client.signIn).toHaveBeenCalledTimes(1);
    // Nothing of the app's session is kept in this browser.
    const after = fakeClient();
    new SessionStore(APP, resolveTarget(ENV), storage).restore(after as unknown as CalimeroClient);
    expect(after.session?.accountId).toBe(STORED.accountId);
    expect(screen.getByTestId("handoff")).toBeTruthy();
  });

  it("opened directly, says the app runs on the iPhone once signed in", async () => {
    const storage = new Memory();
    new SessionStore(APP, resolveTarget(ENV), storage).save(STORED);
    render(<App deps={deps(storage)} />);
    expect(await screen.findByTestId("signed-in")).toBeTruthy();
    expect(screen.getByText(/runs on your iPhone/)).toBeTruthy();
  });

  it("asks for the passkey approval the app opened it for", () => {
    const approval = { state: "s".repeat(24), key: "k", challenge: "c".repeat(32), rpId: "apps.calimero.network", allow: [] };
    render(<App deps={deps(new Memory())} approval={approval} />);
    expect(screen.getByText("Approve in Mero AR")).toBeTruthy();
    expect(screen.getByTestId("native-approve")).toBeTruthy();
  });
});
