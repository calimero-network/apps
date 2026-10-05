// The ONE place the app decides how it talks to Calimero.
//
// Two kinds of session play the same game:
//   - `node`    — the player logged into their own merod (web login or the
//                 desktop's SSO hash). Admin calls are the node's REST routes
//                 with a bearer token, contract calls go to `/jsonrpc`, events
//                 are the node's `/sse`. Unchanged from before accounts existed.
//   - `account` — the player enrolled a device with their Calimero account at
//                 the wallet and plays through a relay. Admin calls are the
//                 mero-js account admin (governance + creation warrants signed
//                 by the device, reads through the relay), contract calls are
//                 warrants on `/intents` (reads via the relay query route),
//                 events are the relay's SSE on the account session.
//
// Everything above this module (`admin.ts`, `client.ts`, the UI) asks for
// `getTransport()` and never looks at `session.kind` again; nothing above it
// builds a node URL or a bearer header. The two implementations live in
// `nodeTransport.ts` and `accountTransport.ts`.

import { sessionEpoch, sessionKind, type SessionKind } from "./session";
import type { SignedInvitation } from "./inviteCodec";
import { createNodeTransport } from "./nodeTransport";
import { createAccountTransport } from "./accountTransport";

export interface ContextInfo {
  contextId: string;
  applicationId: string;
  /** human name of the world, when the record carries one */
  name?: string;
}

export interface CreatedNamespace {
  namespaceId: string;
  /** Account path only: whether the cloud agreed to host the namespace (HA). */
  haEnabled?: boolean;
  /** Account path only: why `haEnabled` is false, in words a player can act on. */
  haError?: string;
}

export interface CreatedContext {
  contextId: string;
  memberPublicKey: string;
}

export interface MintedInvitation {
  invitation: SignedInvitation;
  groupName?: string;
}

/**
 * The admin primitives mero-blocks needs — the world picker, world creation,
 * the invite flow. One method per thing the app does, so each transport
 * answers with ITS wire (REST route vs. signed warrant) behind the same name.
 */
export interface AdminOps {
  /**
   * The id of this application. Node: checked against what the node has
   * installed (`pickApplicationId`). Account: derived from the registry —
   * `listApplications` is a node's view and does not exist for an account.
   */
  resolveApplicationId(sessionAppId: string): Promise<string>;
  listContexts(): Promise<ContextInfo[]>;
  createNamespace(applicationId: string, name: string): Promise<CreatedNamespace>;
  createOpenGroup(namespaceId: string, name: string): Promise<string>;
  createContext(
    applicationId: string,
    groupId: string,
    name: string,
    initializationParams: number[],
  ): Promise<CreatedContext>;
  identitiesOwned(contextId: string): Promise<string[]>;
  joinContext(contextId: string): Promise<void>;
  contextGroup(contextId: string): Promise<string>;
  namespacesForApplication(applicationId: string): Promise<string[]>;
  namespaceGroups(namespaceId: string): Promise<string[]>;
  groupVisibility(groupId: string): Promise<string>;
  setGroupOpen(groupId: string): Promise<void>;
  createNamespaceInvitation(namespaceId: string): Promise<MintedInvitation>;
  listNamespaces(): Promise<string[]>;
  joinNamespace(namespaceId: string, invitation: SignedInvitation, groupName?: string): Promise<void>;
  joinSubgroupInheritance(groupId: string): Promise<void>;
  syncGroup(groupId: string): Promise<void>;
  groupContexts(groupId: string): Promise<ContextInfo[]>;
}

/** The slice of mero-js's `SseClient` the game uses — both transports hand one out. */
export interface EventStream {
  on(event: "connect", handler: (...args: unknown[]) => void): void;
  on(event: "event", handler: (evt: unknown) => void): void;
  on(event: "error", handler: (err: Error) => void): void;
  connect(): Promise<void>;
  subscribe(contextIds: string[]): Promise<void>;
  close(): void;
}

export interface Transport {
  readonly kind: SessionKind;
  /**
   * Resolves once the transport can serve reads and events. Immediate on a
   * node; on an account it is the relay's node key being learned (attested)
   * and pinned, which admin reads and the event stream need.
   */
  ready(): Promise<void>;
  /** Call a contract method on a context. */
  exec<T = unknown>(contextId: string, method: string, args: Record<string, unknown>): Promise<T>;
  readonly admin: AdminOps;
  /** A live event stream to subscribe the world's context on; `null` when there is nothing to stream from. */
  openEvents(): EventStream | null;
  /**
   * "Me" as the contract sees it: the id it keys player rows and `BlocksChanged`
   * authors by. Node: the context identity this node owns. Account: the
   * delegated device's signing key — the contract uses `env::device_id()`, and
   * under delegation that is the device cert's key, NOT the account.
   */
  resolveMyId(contextId: string): Promise<string | null>;
}

let current: { kind: SessionKind; epoch: number; transport: Transport } | null = null;

/**
 * The transport for the current session kind — THE switch. Built once per
 * session (kind + login epoch) and kept until the session changes or
 * `resetTransport()`.
 */
export function getTransport(): Transport {
  const kind: SessionKind = sessionKind();
  const epoch = sessionEpoch();
  if (current?.kind !== kind || current.epoch !== epoch) {
    current = {
      kind,
      epoch,
      transport: kind === "account" ? createAccountTransport() : createNodeTransport(),
    };
  }
  return current.transport;
}

/** Drop the cached transport (logout, session switch, tests). */
export function resetTransport(): void {
  current = null;
}
