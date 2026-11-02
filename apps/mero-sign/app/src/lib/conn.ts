import type { CalimeroClient, PasskeyProvider } from '@calimero-network/mero-js';
import type { AppSource, Target } from '@calimero-apps/connect';

import { meroSign, type MeroSign } from './meroSign';

/**
 * A signed-in connection: the client, who is signed in, where instances come
 * from (the dev bundle, or the package), and the passkey that answers a
 * step-up. Set by `CalimeroProvider` when a session exists.
 */
export interface Conn {
  client: CalimeroClient;
  accountId: string;
  target: Target;
  source: AppSource;
  passkey: () => PasskeyProvider;
  /** After every request: keeps the stored session in step with a refresh. */
  after: () => void;
}

let current: Conn | null = null;

/** The provider's connection, for the services that are not components. */
export function setConn(conn: Conn | null): void {
  current = conn;
}

export function getConn(): Conn | null {
  return current;
}

/** The connection, or a clear error when nobody is signed in. */
export function requireConn(): Conn {
  if (!current) throw new Error('Sign in first: there is no session.');
  return current;
}

/** The contract at app instance `app`, through `conn`. */
export function contractAt(conn: Conn, app: string): MeroSign {
  return meroSign(conn.client, app, conn.passkey, conn.after);
}
