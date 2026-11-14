/**
 * The node-shield gate every signed-in app runs: its real session layer,
 * mounted with a session kept in `localStorage` and a fake client, must put
 * the shield on the page. An app's `nodeShield.gate.test.tsx` is one call to
 * `nodeShieldGate`; scripts/check-node-shield-gate.py fails an app with
 * neither one nor a reason to go without.
 */
import { cleanup, screen, waitFor } from "@testing-library/react";
import type { CalimeroClient, CalimeroSession } from "@calimero-network/mero-js";
import { SessionStore, resolveTarget, type ConnectEnv } from "@calimero-apps/connect";
import { afterEach, expect, it } from "vitest";

import type { SessionDeps } from "./session";

const ENV: ConnectEnv = { DEV: true, VITE_CALIMERO_BUNDLE: "bundle-hash" };
const SESSION: CalimeroSession = { accountId: "acct-gate", sessionToken: "s", refreshToken: "r", expiresAt: 9e12 };
const NODE = "http://127.0.0.1:2528";

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
    verification: () => ({ status: "verified", url: NODE, mock: true, checkedAt: Date.now() }),
    verify: async () => ({ status: "verified", url: NODE, mock: true, checkedAt: Date.now() }),
  } as unknown as CalimeroClient;
}

/**
 * Registers the gate for `app` (the name its session is stored under).
 * `mount` renders the app's session provider or hook with the deps it is given.
 */
export function nodeShieldGate(app: string, mount: (deps: SessionDeps) => void) {
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });
  it(`${app}: shows the node shield once signed in`, async () => {
    new SessionStore(app, resolveTarget(ENV), localStorage).save(SESSION);
    const deps: SessionDeps = { env: ENV, makeClient: async () => fakeClient(), passkey: () => ({}) as never, storage: localStorage };
    mount(deps);
    try {
      await waitFor(() => expect(screen.getAllByTestId("node-shield")).toHaveLength(1));
    } catch {
      throw new Error(
        `${app} signed in but renders no node shield: show it with usePasskeySession or bindNodeShield (@calimero-apps/passkey)`,
      );
    }
  });
}
