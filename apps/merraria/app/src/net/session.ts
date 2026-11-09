// The connection: which cluster (merod local in dev, a Calimero Cloud cluster
// in production, both through @calimero-apps/connect), the mero-js
// CalimeroClient for it, and the passkey session kept per app and target.
//
// This replaces v1's two transports (a node login with bearer tokens, or a
// wallet-enrolled device key writing through a relay), the desktop SSO hash
// and the node-auth redirect: an account is a passkey, on every target.

import { browserPasskey, type CalimeroClient, type PasskeyProvider, type SignUpPolicy } from "@calimero-network/mero-js";
import {
  SessionStore,
  createClient,
  connectTarget,
  targetKey,
  type ConnectEnv,
  type KeyValueStorage,
  type Target,
} from "@calimero-apps/connect";
import type { SignUpFlow } from "@calimero-apps/passkey/signUpFlow";
import {
  knownAccountHere,
  signInHere,
  signUpFlowHere,
  signUpHere,
  type JoinedAtSignUp,
} from "@calimero-apps/passkey/ceremony";
import { PACKAGE } from "./merraria";

/** The app's name in stored keys. */
export const APP = "merraria";

/** What a connection is built from: the real ones in the app, fakes in tests. */
export interface ConnectDeps {
  env: ConnectEnv;
  makeClient: (target: Target) => Promise<CalimeroClient>;
  passkey: () => PasskeyProvider;
  storage?: KeyValueStorage;
  /** The cluster's node list when this page is served by it (production). */
  servedNodes?: () => Promise<string[] | null>;
}

export const defaultDeps: ConnectDeps = {
  env: import.meta.env,
  makeClient: (target) => createClient(target),
  passkey: browserPasskey,
};

export class Connection {
  constructor(
    readonly client: CalimeroClient,
    readonly target: Target,
    readonly sessions: SessionStore,
    private readonly passkey: () => PasskeyProvider,
    readonly storage: KeyValueStorage | undefined,
  ) {}

  /** The signed-in account, or null. */
  get accountId(): string | null {
    return this.client.session?.accountId ?? null;
  }

  /** Keeps the stored session current: the client swaps the single-use refresh token on a 401. */
  readonly sync = (): void => {
    this.sessions.sync(this.client);
  };

  /** This browser has signed in to an account on this cluster before. */
  knownAccount(): boolean {
    return knownAccountHere(this.target, this.storage);
  }

  /** Sign in, offering only the passkeys that have worked on this cluster (@calimero-apps/passkey). */
  async signIn(): Promise<string> {
    const { accountId } = await signInHere(this.client, this.target, this.passkey(), this.storage);
    this.sync();
    return accountId;
  }

  /**
   * One sign-up's passkey (pass its `passkey` to `signUp`): the second prompt
   * is asked right after the first, and waits for `flow.approve()`, a click of
   * its own, only when that ask failed or was refused (Safari's user-gesture
   * rule, a blocked prompt, a closed prompt).
   */
  newSignUp(onChange: () => void): SignUpFlow {
    return signUpFlowHere(this.passkey(), this.target, this.storage, onChange);
  }

  /**
   * A new account (a new passkey). The page's `invite` goes with it wherever
   * the cluster's `policy` lets an organization invite admit, and `joined`
   * says the account is in the invite's world already (nothing to redeem).
   */
  async signUp(
    name: string,
    { invite = null, policy }: { invite?: string | null; policy?: SignUpPolicy | null } = {},
    passkey: PasskeyProvider = this.passkey(),
  ): Promise<{ accountId: string; joined: JoinedAtSignUp | null }> {
    const made = await signUpHere(this.client, this.target, passkey, {
      name,
      invite,
      policy,
      join: true,
      storage: this.storage,
    });
    this.sync();
    return made;
  }

  async signOut(): Promise<void> {
    try {
      await this.client.signOut();
    } catch {
      // Already expired or unreachable: forgetting it here is what matters.
    }
    this.sessions.clear();
  }

  /** The passkey prompt for a step-up (making an invitation). */
  approver(): PasskeyProvider {
    return this.passkey();
  }

  /** "merod local (3 nodes)" / "Calimero Cloud eu-shared-1". */
  describe(): string {
    return describeTarget(this.target);
  }

  /** A stored key scoped to this target and the signed-in account. */
  scopedKey(name: string): string | null {
    const account = this.accountId;
    return account ? `${APP}:${name}:${targetKey(this.target)}:${account}` : null;
  }
}

/**
 * Connects to the local nodes (dev) or the Cloud cluster (production) and
 * restores a stored session. Throws `ConfigError` for a production build with
 * no cluster or release floor (see .env.example).
 */
export async function connect(deps: ConnectDeps = defaultDeps): Promise<Connection> {
  const target = await connectTarget(deps.env, { servedNodes: deps.servedNodes, app: APP, package: PACKAGE });
  const client = await deps.makeClient(target);
  const sessions = new SessionStore(APP, target, deps.storage);
  sessions.restore(client);
  return new Connection(client, target, sessions, deps.passkey, deps.storage);
}

export function describeTarget(target: Target): string {
  return target.kind === "local"
    ? `merod local (${target.nodes.length} node${target.nodes.length === 1 ? "" : "s"})`
    : `Calimero Cloud ${target.cluster}`;
}

/** `ab12…ef90` for a long account id. */
export function shortAccount(id: string): string {
  return id.length > 14 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id;
}
