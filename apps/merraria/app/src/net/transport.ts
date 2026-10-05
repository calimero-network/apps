// The ONE place the game decides how it talks to the network.
//
// A session is either a node login (bearer tokens against `{node}/admin-api`
// and `/jsonrpc`) or an account (a wallet-certified device key writing through
// a relay as `/intents` warrants and reading through the relay's query route).
// Everything above this module — the world picker, invites, the game client —
// asks for `getTransport()` and gets the same two surfaces either way:
//
//   admin  — mero-js `AdminApiClient`. On a node it IS the node's admin client;
//            on an account it is `createAccountAdmin`, the same method names
//            with writes turned into warrants and node-only calls refused by
//            name (`NotForAccountError`).
//   rpc    — mero-js `ExecuteTransport`: `execute({contextId, method, argsJson})`.
//
// No raw `fetch` to a node route exists anywhere in `src/` — mero-js owns the
// wire (bearer vs device-cert auth, token refresh, warrant nonces, the relay's
// attested node key). This module only chooses which client to build.

import {
  CloudClient,
  NotForAccountError,
  buildDelegatedClient,
  createAccountAdmin,
  createMeroClient,
  foundDelegatedNamespace,
  joinAsAccount,
  resolveApplicationIdFromRegistry,
  resolveRelayNodeKey,
  saveDelegatedSession,
  signerFromSecret,
  type AdminApiClient,
  type DelegatedAccountSession,
  type ExecuteTransport,
  type MeroClient,
  type SseClient,
  type TokenData,
  type TokenStore,
} from "@calimero-network/mero-js";
import { PACKAGE_NAME, REGISTRY_URL } from "./auth";
import {
  clearSession,
  getAccountSession,
  getSession,
  sessionKind,
  updateSession,
  type SessionKind,
} from "./session";

export interface Transport {
  readonly kind: SessionKind;
  /** admin surface — identical shape on both transports */
  readonly admin: AdminApiClient;
  /** contract calls; on an account with no relay yet every call refuses */
  readonly rpc: ExecuteTransport;
  /** the session's event stream; null while an account has no relay */
  events(): SseClient | null;
  /**
   * "Me" as the CONTRACT sees it (its `caller()` is `env::device_id()`): on a
   * node, the context identity the node owns; on an account, the delegated
   * device's signing key — the one thing the certificate names, and what the
   * relay attributes every warrant to. The account id is "me" at the
   * governance level only; comparing it against a `TilesChanged(member)` event
   * would suppress nothing and toast on our own edits.
   */
  myId(contextId: string): Promise<string | null>;
  /**
   * Our application id. A node answers from what it has installed (never a
   * baked id — MRR6: a remembered id this node doesn't know is an opaque 500);
   * an account installs nothing, so it is derived from the registry's listing
   * of our package, the way merod computes it.
   */
  resolveApplicationId(): Promise<string | null>;
  close(): void;
}

// ---- node ---------------------------------------------------------------

const TOKENS_KEY = "mero-tokens";

/**
 * mero-js's token store over the `mero-tokens` bundle session.ts writes.
 * mero-js's own `LocalStorageTokenStore` refuses a bundle without a refresh
 * token; a desktop SSO hand-over can carry an access token alone, and that is
 * still a login. `expires_at` may be a string ("" or a stamp) in our format.
 */
export function merrariaTokenStore(): TokenStore {
  return {
    getTokens(): TokenData | null {
      try {
        const raw = localStorage.getItem(TOKENS_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as Partial<TokenData> & { expires_at?: string | number };
        if (!parsed?.access_token) return null;
        let exp = Number(parsed.expires_at);
        if (!Number.isFinite(exp) || exp <= 0) exp = Date.now() + 3600_000;
        else if (exp < 1e12) exp *= 1000;
        return {
          access_token: parsed.access_token,
          refresh_token: parsed.refresh_token ?? "",
          expires_at: exp,
        };
      } catch {
        return null;
      }
    },
    setTokens(data: TokenData): void {
      try {
        localStorage.setItem(TOKENS_KEY, JSON.stringify(data));
      } catch {
        /* storage unavailable — the in-memory bundle still serves this tab */
      }
    },
    clear(): void {
      try {
        localStorage.removeItem(TOKENS_KEY);
      } catch {
        /* nothing to clear */
      }
    },
  };
}

/** unwrap {apps: []} | {applications: []} | [] */
export function parseApplications(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) return data as Record<string, unknown>[];
  const obj = (data ?? {}) as Record<string, unknown>;
  for (const key of ["apps", "applications", "items"]) {
    if (Array.isArray(obj[key])) return obj[key] as Record<string, unknown>[];
  }
  return [];
}

/** the package id of an application record, wherever this node version put it */
export function packageOf(app: Record<string, unknown>): string {
  const direct = app.package ?? app.packageName ?? app.package_name;
  if (typeof direct === "string" && direct) return direct;
  const manifest = app.manifest as Record<string, unknown> | undefined;
  if (manifest && typeof manifest.package === "string") return manifest.package;
  // some versions serialize metadata as bytes of the manifest json
  if (Array.isArray(app.metadata)) {
    try {
      const text = new TextDecoder().decode(new Uint8Array(app.metadata as number[]));
      const parsed = JSON.parse(text);
      if (typeof parsed?.package === "string") return parsed.package;
    } catch {
      /* metadata was not manifest json */
    }
  }
  return "";
}

const appIdOf = (app: Record<string, unknown>): string =>
  String(app.id ?? app.applicationId ?? app.application_id ?? "");

/**
 * Pick our application id out of the node's installed apps (mero-blocks'
 * `pickApplicationId`, ported for MRR6).
 *
 * Order: the id this session was handed (the SSO/auth-callback hash — the URL
 * beats anything remembered) > the installed app carrying our package name >
 * the lone app on a dev node.
 *
 * Every candidate is a PREFERENCE, checked against what this node actually
 * has; none is an override. The session id used to be trusted outright, and a
 * remembered id survives switching nodes and reinstalling the app: the node
 * answers a request carrying an unknown application with an opaque `500` that
 * never mentions application ids. There is deliberately no `VITE_APPLICATION_ID`
 * either: the id is `hash(package, signer)`, so a registry-signed release and
 * a local `cargo mero bundle --dev` of the same code differ.
 */
export function pickApplicationId(apps: Record<string, unknown>[], sessionAppId: string): string {
  if (sessionAppId && apps.some((a) => appIdOf(a) === sessionAppId)) return sessionAppId;
  const match = apps.find((a) => packageOf(a) === PACKAGE_NAME);
  const chosen = match ?? (apps.length === 1 ? apps[0] : undefined);
  return chosen ? appIdOf(chosen) : "";
}

/** the identity a node owns for a context ("" when not a member) */
async function ownedIdentity(admin: AdminApiClient, contextId: string): Promise<string> {
  const data = (await admin.getContextIdentitiesOwned(contextId)) as unknown;
  const obj = (data ?? {}) as Record<string, unknown>;
  const arr = Array.isArray(data) ? data : ((obj.identities ?? obj.items ?? []) as unknown[]);
  return Array.isArray(arr) && arr.length > 0 ? String(arr[0]) : "";
}

function nodeTransport(nodeUrl: string): Transport {
  const client: MeroClient = createMeroClient({
    transport: "node",
    baseUrl: nodeUrl,
    tokenStore: merrariaTokenStore(),
    // A revoked token family (single-use refresh token replayed, or an
    // explicit revocation) is terminal: nothing we hold is live.
    onAuthRevoked: () => {
      console.warn("[transport] auth revoked — clearing session, re-login required");
      clearSession();
    },
  });
  return {
    kind: "node",
    admin: client.admin,
    rpc: client.rpc,
    events: () => client.events,
    async myId(contextId) {
      // The hash's identity, else what the NODE reports owning. Deliberately
      // no cached fallback: a cache that answers when the node cannot is a lie
      // about membership, and `null` is what boot() acts on.
      const s = getSession();
      if (s.executorPublicKey) return s.executorPublicKey;
      const owned = await ownedIdentity(client.admin, contextId).catch(() => "");
      return owned || null;
    },
    async resolveApplicationId() {
      const sessionAppId = getSession().applicationId ?? "";
      const apps = parseApplications(await client.admin.listApplications());
      const id = pickApplicationId(apps, sessionAppId);
      // A session value that fails the check is cleared rather than left to
      // come back on the next call.
      if (id !== sessionAppId) updateSession({ applicationId: id || null });
      return id || null;
    },
    close: () => client.close(),
  };
}

// ---- account ----------------------------------------------------------

/** What an account with no relay answers to a contract call. */
export const NO_RELAY_MESSAGE =
  "this account has no relay yet — create a world or join one with an invite first";

function noRelayRpc(): ExecuteTransport {
  const refuse = async () => {
    throw new Error(NO_RELAY_MESSAGE);
  };
  return {
    kind: "relay",
    canSubscribe: false,
    execute: refuse,
    executeWithMetadata: refuse,
    migrateMyEntries: refuse,
    countMyPending: refuse,
  };
}

async function accountTransport(s: DelegatedAccountSession): Promise<Transport> {
  // Attest the relay BEFORE trusting a session on it: its node key (learned
  // from the relay's TEE quote, pinned afterwards) is what lets the client
  // mint a session for admin reads and the event stream. Without it the
  // client still writes (warrants need no session) but reads and events are
  // dormant; `resolveRelayNodeKey` is a no-op once the key is pinned.
  let client: MeroClient | null = null;
  if (s.relayUrl) {
    await resolveRelayNodeKey(s.relayUrl);
    client = buildDelegatedClient(s, null);
  }
  const routingCredential = { credential: s.credential, deviceSecret: s.deviceSecret };
  const admin = createAccountAdmin(
    {
      session: s,
      read: client?.admin ?? null,
      app: { packageName: PACKAGE_NAME, registryUrl: REGISTRY_URL },
    },
    {
      // Redeeming an invitation is how an account gets (another) relay: the
      // join resolves the admitting relay, is carried by it, and the session
      // moves onto it. The transport is rebuilt on the next `getTransport()`.
      join: (namespaceId, invitation) =>
        joinAsAccount(s, namespaceId, invitation, {
          onJoined: (next) => {
            saveDelegatedSession(next);
            resetTransport();
          },
        }),
      found: (session, req) => foundDelegatedNamespace(session, req),
      // The cloud's routing for a namespace, so an invitation is minted only
      // when somebody could claim it (and says where, for an unlinked founder).
      routing: (namespaceId) =>
        new CloudClient({ routingCredential }).getNamespaceRouting(namespaceId),
    },
  );
  return {
    kind: "account",
    admin,
    rpc: client?.rpc ?? noRelayRpc(),
    events: () => client?.events ?? null,
    async myId() {
      // The device cert's signing key (hex, as the contract renders a
      // `PublicKey`) — see the interface doc. Derived from the session itself.
      return (await signerFromSecret(s.deviceSecret, "deviceSecret")).publicKey;
    },
    async resolveApplicationId() {
      const cached = getSession().applicationId;
      if (cached) return cached;
      const { applicationId } = await resolveApplicationIdFromRegistry(REGISTRY_URL, PACKAGE_NAME);
      updateSession({ applicationId });
      return applicationId;
    },
    close: () => client?.close(),
  };
}

// ---- the switch ---------------------------------------------------------

let current: { key: string; transport: Promise<Transport> } | null = null;

/** The cache key: anything that changes which client to build. */
function sessionKey(): string | null {
  const kind = sessionKind();
  if (kind === "node") return `node|${getSession().nodeUrl}`;
  if (kind === "account") {
    const a = getAccountSession()!;
    return `account|${a.account}|${a.relayUrl ?? ""}`;
  }
  return null;
}

/**
 * The transport for the current session. Built once per session (node url /
 * account + relay) and rebuilt when any of that changes — switching nodes,
 * an account joining through a new relay, logging out and in.
 */
export function getTransport(): Promise<Transport> {
  const key = sessionKey();
  if (!key) return Promise.reject(new Error("not logged in — connect a node or sign in with your account"));
  if (current?.key === key) return current.transport;
  current?.transport.then((t) => t.close()).catch(() => {});
  const kind = sessionKind();
  const transport =
    kind === "account"
      ? accountTransport(getAccountSession()!)
      : Promise.resolve(nodeTransport(getSession().nodeUrl!));
  current = { key, transport };
  // a build that failed must not be served again
  transport.catch(() => {
    if (current?.key === key) current = null;
  });
  return transport;
}

/** Drop the cached transport so the next call rebuilds from the session. */
export function resetTransport(): void {
  current?.transport.then((t) => t.close()).catch(() => {});
  current = null;
}

/** Whether `err` is a call an account cannot make (hidden in the UI, never reached). */
export function isNodeOnly(err: unknown): boolean {
  return err instanceof NotForAccountError;
}
