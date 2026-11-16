/** The node-shield gate every signed-in app runs: its session layer, mounted signed in, must put exactly one shield on the page. */
import { cleanup, screen, waitFor } from "@testing-library/react";
import type { CalimeroClient, CalimeroSession } from "@calimero-network/mero-js";
import { SessionStore, resolveTarget, type ConnectEnv } from "@calimero-apps/connect";
import { afterEach, it } from "vitest";

import type { SessionDeps } from "./session";

const ENV: ConnectEnv = { DEV: true, VITE_CALIMERO_BUNDLE: "bundle-hash" };
const SESSION: CalimeroSession = { accountId: "acct-gate", sessionToken: "s", refreshToken: "r", expiresAt: 9e12 };
const NODE = "https://node-1.gate.example.net";
const SEALED = { status: "verified", url: NODE, mock: false, release: "2.3.148", profile: "locked-read-only" } as const;

/** A client the shield can check and a stored session can restore into; every other call is left out on purpose. */
function fakeClient(): CalimeroClient {
  let session: CalimeroSession | undefined;
  return {
    nodeUrl: NODE,
    get session() {
      return session;
    },
    useSession: (s: CalimeroSession) => {
      session = s;
    },
    signOut: async () => {
      session = undefined;
    },
    // The create-workspace dialog, always mounted, asks whether the session is bound.
    auth: { me: async () => ({}) },
    verification: () => ({ ...SEALED, checkedAt: Date.now() }),
    verify: async () => ({ ...SEALED, checkedAt: Date.now() }),
  } as unknown as CalimeroClient;
}

/**
 * Registers the gate for `app`, the name its session is stored under.
 * `mount` renders the app's real root, or its session layer where the test project cannot hold the root, with the deps it is given.
 */
export function nodeShieldGate(app: string, mount: (deps: SessionDeps) => void) {
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });
  it(`${app}: shows the node shield once signed in`, async () => {
    new SessionStore(app, resolveTarget(ENV), localStorage).save(SESSION);
    const client = fakeClient();
    const deps: SessionDeps = { env: ENV, makeClient: async () => client, passkey: () => ({}) as never, storage: localStorage };
    mount(deps);
    const shields = () => screen.queryAllByTestId("node-shield").length;
    const signedIn = () => client.session?.accountId === SESSION.accountId;
    try {
      await waitFor(() => {
        if (!signedIn() || shields() !== 1) throw new Error("not yet");
      });
    } catch {
      throw new Error(
        `${app}: ${signedIn() ? "signed in" : "did not restore the stored session"} and rendered ${shields()} node shields, expected 1 (usePasskeySession or bindNodeShield, @calimero-apps/passkey)`,
      );
    }
  });
}
