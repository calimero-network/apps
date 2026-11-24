import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { CalimeroClient, CalimeroSession } from "@calimero-network/mero-js";
import { SessionStore, resolveTarget } from "@calimero-apps/connect";
import { b64url, captureNativeSignIn, dropNativeSignIn } from "@calimero-apps/passkey/native";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { APP, type SessionDeps } from "./session";

const ENV = { DEV: true, VITE_CALIMERO_BUNDLE: "bundle-hash" };
const SESSION: CalimeroSession = { accountId: "acct-alice", sessionToken: "s", refreshToken: "r", expiresAt: 9e12 };
const NODE = "http://127.0.0.1:2501";

afterEach(() => {
  cleanup();
  dropNativeSignIn();
  localStorage.clear();
});

function fakeClient(): CalimeroClient {
  let session: CalimeroSession | undefined;
  return {
    nodeUrl: NODE,
    nodes: [NODE, "http://127.0.0.1:2502"],
    get session() {
      return session;
    },
    useSession: (s: CalimeroSession) => {
      session = s;
    },
    signOut: async () => {
      session = undefined;
    },
    auth: { me: async () => ({}) },
    verification: () => ({ status: "verified", url: NODE, mock: true, checkedAt: Date.now() }),
    verify: async () => ({ status: "verified", url: NODE, mock: true, checkedAt: Date.now() }),
    signUpPolicy: async () => ({ mode: "open" }),
  } as unknown as CalimeroClient;
}

function deps(client = fakeClient()): SessionDeps {
  return { env: ENV, makeClient: async () => client, passkey: () => ({}) as never, storage: localStorage };
}

function signedIn() {
  new SessionStore(APP, resolveTarget(ENV), localStorage).save(SESSION);
}

/** What the iOS app puts in the fragment: a fresh P-256 key and a random state. */
async function openedByTheApp() {
  const pair = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
  const key = b64url(new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey)));
  const state = b64url(crypto.getRandomValues(new Uint8Array(24)));
  captureNativeSignIn({ hash: `#native-sign-in&state=${state}&key=${key}`, pathname: "/", search: "" }, sessionStorage, {
    replaceState: () => {},
  });
  return state;
}

describe("Mero Tag's served page", () => {
  it("tells a visitor the app is on the iPhone", async () => {
    render(<App deps={deps()} approval={null} />);
    expect(await screen.findByTestId("intro")).toBeTruthy();
  });

  it("asks the iOS app's sign-in for a passkey", async () => {
    await openedByTheApp();
    render(<App deps={deps()} approval={null} />);
    expect(await screen.findByTestId("signin-page")).toBeTruthy();
  });

  it("seals the session back to mero-tag://signed-in and forgets it here", async () => {
    const state = await openedByTheApp();
    signedIn();
    const go = vi.fn();
    render(<App deps={deps()} approval={null} go={go} />);
    await waitFor(() => expect(go).toHaveBeenCalledTimes(1));
    const url = String(go.mock.calls[0]?.[0]);
    expect(url.startsWith(`mero-tag://signed-in#state=${encodeURIComponent(state)}&box=`)).toBe(true);
    expect(new SessionStore(APP, resolveTarget(ENV), localStorage).restore(fakeClient())).toBe(false);
  });

  it("asks for an approval the app requested", () => {
    const request = { state: "s".repeat(16), key: "k", challenge: "c".repeat(16), rpId: "calimero.network", allow: [] };
    render(<App deps={deps()} approval={request} />);
    expect(screen.getByTestId("native-approve")).toBeTruthy();
  });
});
