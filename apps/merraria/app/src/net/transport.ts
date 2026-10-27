// The ONE place the game decides how it talks to the network.
//
// The player is signed in to a Calimero Cloud cluster with a passkey. Everything
// above this module — the world picker, invites, the game client — asks for
// `getTransport()` and gets:
//
//   admin  — v1's `AdminApiClient` method names over the cluster's
//            organizations (worlds' namespaces), teams and app instances
//            (`@calimero-apps/cloud`).
//   rpc    — `ExecuteTransport`: `execute({contextId, method, argsJson})`.
//
// Every request is sealed to an attested node by the cloud client; no raw
// `fetch` to a node route exists anywhere in `src/`.

import {
  CloudMero,
  createCloudAdmin,
  currentApplicationId,
  ensurePackage,
  NotForAccountError,
  type AdminApiClient,
  type ExecuteTransport,
  type SseClient,
} from "@calimero-apps/cloud";
import { PACKAGE_NAME, REGISTRY_URL } from "./auth";
import { getSession, sessionKind, updateSession, type SessionKind } from "./session";

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

function cloudTransport(clusterUrl: string): Transport {
  const mero = new CloudMero(clusterUrl);
  return {
    kind: "node",
    admin: createCloudAdmin(mero) as unknown as AdminApiClient,
    rpc: mero.rpc as unknown as ExecuteTransport,
    events: () => mero.events as unknown as SseClient,
    // The contract's caller is the player's account on Calimero Cloud.
    myId: async () => mero.accountId().catch(() => null),
    async resolveApplicationId() {
      // A development cluster runs the bundle this build names; anything else
      // installs the signed package from the registry (verified by every node).
      const id = currentApplicationId() ?? (await ensurePackage(mero, PACKAGE_NAME, undefined, REGISTRY_URL));
      if (id !== getSession().applicationId) updateSession({ applicationId: id });
      return id;
    },
    close: () => mero.close(),
  };
}

// ---- the switch ---------------------------------------------------------

let current: { key: string; transport: Promise<Transport> } | null = null;

/** The cache key: anything that changes which client to build. */
function sessionKey(): string | null {
  return sessionKind() === "node" ? `node|${getSession().nodeUrl}` : null;
}

/**
 * The transport for the current session. Built once per session (node url /
 * account + relay) and rebuilt when any of that changes — switching nodes,
 * an account joining through a new relay, logging out and in.
 */
export function getTransport(): Promise<Transport> {
  const key = sessionKey();
  if (!key) return Promise.reject(new Error("not signed in — sign in with your passkey"));
  if (current?.key === key) return current.transport;
  current?.transport.then((t) => t.close()).catch(() => {});
  const transport = Promise.resolve(cloudTransport(getSession().nodeUrl!));
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
