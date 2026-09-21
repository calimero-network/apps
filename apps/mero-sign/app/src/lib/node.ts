/**
 * Everything Mero Sign used to reach for in `@calimero-network/calimero-client`,
 * on mero-js instead.
 *
 * ── Why the old SDK had to go entirely ──────────────────────────────────────
 *
 * Its provider ships a hardcoded connect screen ("Select your Calimero node
 * type to continue… Using default local node: http://node1.127.0.0.1.nip.io")
 * that no prop removes, and its `apiClient` still sends bodies core stopped
 * accepting — `protocol` on `createContext`, `executorPublicKey` on JSON-RPC.
 * Both are unknown fields against `deny_unknown_fields`, i.e. a 400 for the
 * whole call at rc.41.
 *
 * Keeping it "just for the data layer" was not an option either: the two SDKs
 * store the session in different places (mero-react writes the `mero-tokens`
 * blob, calimero-client writes `access_token`/`refresh_token`), so signing in
 * through one leaves the other signed out. It is one SDK or the other.
 *
 * ── What this module is ─────────────────────────────────────────────────────
 *
 * A thin, TYPED surface for the four node calls and two blob calls the app
 * actually made, so the call sites change an import rather than their logic.
 * It is deliberately not a general-purpose wrapper — anything new should call
 * `mero.admin` directly.
 */
import type { MeroJs } from '@calimero-network/mero-js';

/**
 * The old SDK's result shape, kept because ~20 call sites branch on it.
 *
 * `{ data, error }` rather than throwing. Reproduced rather than replaced
 * because rewriting every `if (result.error)` into a try/catch is a large,
 * mechanical diff through code that signs documents, and this migration is
 * already changing the SDK underneath all of it.
 */
export type ErrorResponse = { code?: number; message: string };

/**
 * ⚠️ `ApiResponse<T>` IS ITSELF A PROMISE, and a discriminated union.
 *
 * Copied from the old SDK exactly (`ResponseData<D>` in
 * `lib/types/api-response.d.ts`), because ~20 call sites declare
 * `async foo(): ApiResponse<Bar>` — legal only because the alias already
 * includes `Promise`. Defining it as a plain object here produced 82 type
 * errors of the form "the return type of an async function must be the global
 * Promise<T>", which is the compiler noticing the same thing.
 *
 * The union is load-bearing too: `data` is `null` on the error arm, not
 * `undefined`, and call sites assign `{ data: null, error }` directly.
 */
export type ResponseData<D> =
  | { data: D; error?: null }
  | { data?: null; error: ErrorResponse };

export type ApiResponse<T> = Promise<ResponseData<T>>;

/** Run a call and return the old SDK's `{data, error}` instead of throwing. */
async function wrap<T>(run: () => Promise<T>): ApiResponse<T> {
  try {
    return { data: await run(), error: null };
  } catch (e) {
    return {
      error: { message: e instanceof Error ? e.message : String(e) },
    };
  }
}

export interface NodeApi {
  getContext(contextId: string): ApiResponse<unknown>;
  getContexts(): ApiResponse<unknown>;
  getInstalledApplications(): ApiResponse<unknown>;
  /**
   * Join a namespace from an open invitation.
   *
   * ⚠️ The old `contextInviteByOpenInvitation` named a CONTEXT. Since the
   * workspace/agreement model an invitation grants NAMESPACE membership and
   * the agreement is reached by inheritance from there — which is how every
   * other app in this repo works, and the only shape that lets one invitation
   * cover more than a single document. See `lib/agreements`.
   */
  joinFromInvitation(
    namespaceId: string,
    invitation: unknown,
  ): ApiResponse<JoinNamespaceResult>;
  /**
   * Mint an open invitation. Kept under its old name and argument order so the
   * pages compile unchanged.
   *
   * ⚠️ The grant is NAMESPACE membership now, not membership of one context —
   * the agreement is reached by inheritance from there. That is what lets a
   * single invitation cover a workspace, and it is how every other app in this
   * repo works. `validForBlocks` is accepted and ignored: core clamps an open
   * invitation to 24 hours regardless.
   */
  contextInviteByOpenInvitation(
    namespaceId: string,
    executorPublicKey?: string,
    validForBlocks?: number,
  ): ApiResponse<ContextInviteByOpenInvitationResponse>;
  /**
   * Redeem one.
   *
   * ⚠️ NAMESPACE FIRST. The old signature was `(invitation, publicKey?)`,
   * from when an invitation named a context and the node worked out the rest.
   * `joinNamespace` takes the namespace in the PATH, so it has to be supplied
   * — and it is not optional: the previous code sent `''` and the node has no
   * namespace by that name.
   */
  joinContextByOpenInvitation(
    namespaceId: string,
    invitation: unknown,
  ): ApiResponse<JoinNamespaceResult>;
  /** This node's identity. */
  createNewIdentity(): ApiResponse<NodeIdentity>;
}

/** An open invitation, as minted by the node and carried in a link. */
export interface SignedOpenInvitation {
  invitation?: unknown;
  inviterSignature?: string;
  [k: string]: unknown;
}

/** The node's own identity, as the invitation flow reads it. */
export interface NodeIdentity {
  accountId?: string;
  publicKey?: string;
}

/** What joining a namespace resolves to. */
export interface JoinContextResponse {
  contextId?: string;
  memberPublicKey?: string;
}

/**
 * What `joinNamespace` ACTUALLY answers.
 *
 * ⚠️ THERE IS NO `contextId` IN IT, and that is the shape of the whole
 * invitation flow. Joining a namespace makes you a member of the workspace; it
 * does not put you in any of its agreements — those are subgroups, and you
 * enter one by inheritance afterwards (`enterAgreement` in `lib/agreements`).
 * Code that reads `contextId` off this response gets `undefined` and reports
 * "the node accepted the invitation but did not say which context it joined",
 * which is true and is not the node's fault.
 */
export interface JoinNamespaceResult {
  namespaceId: string;
  groupId?: string;
  memberIdentity: string;
  memberAccount: string;
  groupName?: string;
}

/** What the old `contextInviteByOpenInvitation` resolved to. */
export interface ContextInviteByOpenInvitationResponse {
  contextId?: string;
  memberPublicKey?: string;
}

export function nodeApi(mero: MeroJs): NodeApi {
  return {
    getContext: (contextId) => wrap(() => mero.admin.getContext(contextId)),
    getContexts: () => wrap(() => mero.admin.getContexts()),
    getInstalledApplications: () => wrap(() => mero.admin.listApplications()),
    joinFromInvitation: join,
    contextInviteByOpenInvitation: (namespaceId) =>
      wrap(async () => {
        const res = await mero.admin.createNamespaceInvitation(namespaceId, {});
        return res as ContextInviteByOpenInvitationResponse;
      }),
    joinContextByOpenInvitation: (namespaceId, invitation) =>
      wrap(async () => join_(namespaceId, invitation)),
    createNewIdentity: () =>
      wrap(async () => {
        const id = await mero.admin.getNodeIdentity();
        return { accountId: id?.accountId, publicKey: id?.publicKey };
      }),
  };

  function join(namespaceId: string, invitation: unknown) {
    return wrap(() => join_(namespaceId, invitation));
  }

  /**
   * ⚠️ THE INVITATION IS A FIELD, NOT THE BODY. `JoinNamespaceRequest` is
   * `{invitation, groupName?}`, and every core request body is
   * `deny_unknown_fields` — so posting the bare `SignedGroupOpenInvitation`
   * sends `{invitation: {...}, inviter_signature: ...}` at the top level, which
   * is a 400 naming `inviter_signature` for the whole call. The two are easy to
   * confuse because the signed object has a field of its own called
   * `invitation`.
   */
  async function join_(
    namespaceId: string,
    invitation: unknown,
  ): Promise<JoinNamespaceResult> {
    const res = await mero.admin.joinNamespace(namespaceId, {
      invitation: invitation as Parameters<
        MeroJs['admin']['joinNamespace']
      >[1]['invitation'],
    });
    return res as JoinNamespaceResult;
  }
}

export interface BlobApi {
  /**
   * @param contextId announce the blob to this context, so peers can fetch it.
   *   ⚠️ NOT optional in practice: a blob uploaded without one is reachable
   *   only on the node that stored it, which reads as "the document uploaded
   *   fine and the other signer cannot open it".
   */
  uploadBlob(
    file: Blob,
    onProgress?: (pct: number) => void,
    contextId?: string,
  ): ApiResponse<{ blobId: string; size: number }>;
  /**
   * Resolves to the BYTES, not a `{data, error}` envelope — the call sites hand
   * the result straight to `new Blob([...])`. The old client behaved the same
   * way and the difference is invisible until a PDF renders as `[object
   * Object]`.
   */
  downloadBlob(blobId: string, contextId?: string): Promise<Blob>;
}

export function blobApi(mero: MeroJs): BlobApi {
  return {
    async uploadBlob(file, onProgress, contextId) {
      // mero-js streams the body and reports no progress events. The callback
      // is kept in the signature so call sites are unchanged, and driven to
      // 100% on completion rather than faked mid-flight — a progress bar that
      // invents intermediate values is worse than one that jumps.
      const res = await wrap(() =>
        mero.admin.uploadBlob({ data: file, contextId }),
      );
      if (res.data) onProgress?.(100);
      return res as Awaited<ApiResponse<{ blobId: string; size: number }>>;
    },
    // A Blob, not the raw ArrayBuffer: every call site hands the result
    // straight to `FileReader.readAsDataURL`, which needs one. Returning the
    // buffer type-checks in some positions and renders a PDF as
    // `[object Object]`.
    downloadBlob: async (blobId, contextId) =>
      new Blob([
        await mero.admin.getBlob(blobId, contextId ? { contextId } : undefined),
      ]),
  };
}

// ── The module-level singletons the old SDK exported ────────────────────────
//
// `apiClient` and `blobClient` are reached from services and data sources that
// are not React components and never receive a `mero` instance — so the shape
// is preserved and the instance is registered once, from inside the provider.
//
// ⚠️ It throws rather than returning an error when unset. A null client that
// answers `{error}` is indistinguishable from a node that refused, and this
// app has already shipped one failure that read as the other.

let instance: MeroJs | null = null;

/** Called once, from under `MeroProvider`. See `lib/MeroBridge`. */
export function setMeroInstance(mero: MeroJs | null): void {
  instance = mero;
}

function required(): MeroJs {
  if (!instance) {
    throw new Error(
      'No node connection yet. This call ran before the app finished connecting.',
    );
  }
  return instance;
}

export const apiClient = {
  node: (): NodeApi => nodeApi(required()),
};

/**
 * `mero.admin`, for the code that needs the real namespace/subgroup surface
 * rather than the six-method shim above.
 *
 * The shim exists so ~20 call sites through the signing path did not have to
 * change when the SDK did. The workspace model is new code and has no such
 * debt, so it calls the SDK directly — see the note at the top of this file.
 */
export function adminApi(): MeroJs['admin'] {
  return required().admin;
}

/**
 * The live mero-js instance, for the generated contract client.
 *
 * `lib/signClient` needs the whole SDK rather than `admin` alone, because a
 * generated client issues JSON-RPC. Throws rather than returning null for the
 * reason at the top of this section: a null client that answers `{error}` is
 * indistinguishable from a node that refused.
 */
export function meroInstance(): MeroJs {
  return required();
}

export const blobClient: BlobApi = {
  uploadBlob: (file, onProgress, contextId) =>
    blobApi(required()).uploadBlob(file, onProgress, contextId),
  downloadBlob: (blobId, contextId) =>
    blobApi(required()).downloadBlob(blobId, contextId),
};

// ── Session accessors ───────────────────────────────────────────────────────
//
// The old SDK kept the "current" context and executor in `localStorage` and
// exported these four. Reproduced verbatim, under the SAME keys, so a person
// who was mid-session when this shipped is not silently logged out of their
// last agreement.

const CONTEXT_ID_KEY = 'context-id';
const EXECUTOR_KEY = 'executor-public-key';

/** A read that cannot throw: storage is blocked outright in some browsers. */
function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* a private window is not a reason to fail a call */
  }
}

export const getContextId = (): string | null => read(CONTEXT_ID_KEY);
export const setContextId = (contextId: string): void =>
  write(CONTEXT_ID_KEY, contextId);
export const getExecutorPublicKey = (): string | null => read(EXECUTOR_KEY);
export const setExecutorPublicKey = (key: string): void =>
  write(EXECUTOR_KEY, key);

// ── There is no JSON-RPC shim here any more ─────────────────────────────────
//
// This block held `rpcClient`, `RpcQueryParams`, `RpcResult`, `RpcConfig`,
// `getAuthConfig`, `getContextSpecificAuthConfig` and `getAppEndpointKey` — a
// reimplementation of the OLD SDK's surface on top of mero-js, kept so that
// `ClientApiDataSource`'s ~1,500 lines of hand-written RPC did not have to
// change when the SDK did.
//
// It has no callers left. Every contract call goes through the generated
// `MeroSignClient`, which is where the method names and argument shapes come
// from the ABI rather than from strings in this repo. The shim's own comments
// recorded what it was papering over — `executorPublicKey` accepted and
// silently dropped, an envelope re-wrapped as `{result:{output}}` because the
// call sites unwrapped it that way — and all of that goes with it.
//
// ⚠️ `getAppEndpointKey` went too, and it was not merely unused: it had been
// reduced to `return null`, and `AppHeader` still called it to show which node
// the session was on. That readout had been blank ever since. The URL lives on
// `useMero().nodeUrl`.

/**
 * Re-exported so the two components that imported `useCalimero` from the SDK
 * keep one import line. The implementation is `lib/useCalimero`, on mero-react.
 */
export { useCalimero } from './useCalimero';
