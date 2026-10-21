// Accessor for MeroProvider's client + a thin RPC wrapper that preserves the
// old calimero-client
// `{ result: { output }, error: { code, error: { cause: { info } } } }`
// envelope shape, so dataSource code can keep its existing access patterns
// without per-callsite refactors.
//
// This module is the ONE place the app's data layer meets the session. Every
// admin call and every contract call in `api/`, `utils/` and the components
// goes through `getMeroJs()`; nothing else in the app knows a node URL or a
// token. That is what lets the same code run for a node login and for an
// account (delegated/relay) session: mero-react hands us the right `admin`
// and `rpc` for whichever the user signed in with, and the callers never ask.

// Everything comes from mero-react, including the mero-js surface it
// re-exports (`export * from "@calimero-network/mero-js"`).
//
// Importing mero-js directly would mean declaring it as a second dependency
// beside mero-react, which owns its own copy. Two copies is a correctness
// problem, not untidiness: they can resolve to different majors, and mero-js 14
// changed every id from base58 to hex. Two encodings inside one app, against
// a node that parses one, is the failure this app already hit.
import {
  type AdminApiClient,
  RpcError,
  type Context,
  type ExecuteParams,
  getNodeUrl,
} from "@calimero-network/mero-react";
import type { ResponseData } from "./types";

// The ONE client, owned by MeroProvider and handed to us by <MeroJsBridge>
// (see api/MeroJsBridge.tsx). We deliberately do not construct our own:
// mero-js's refresh single-flight is per-instance, so a second instance over
// the same `mero-tokens` bundle can double-spend a single-use refresh token
// (core#3083) and get the whole token family revoked.
/**
 * What the data sources use: an admin API and the contract RPC, whatever the
 * session.
 *
 * On a node it is the node's own client. On an account it is mero-react's
 * account admin (`useMero().admin`: reads through the relay, writes as
 * delegated ops, node-only methods throw `NotForAccountError`) and the relay
 * transport's RPC (reads via the query route, writes via `/intents` warrants).
 */
export interface ChatClient {
  admin: AdminApiClient;
  rpc: { execute<T>(params: ExecuteParams): Promise<T> };
  /**
   * True on an account (delegated/relay) session. The few places that must
   * differ — which application id to use, which controls have no account form
   * — read this; the data calls themselves do not branch.
   */
  isDelegated: boolean;
  /**
   * The application id this session runs chat under.
   *
   * On an account it is the registry-derived id for chat's package (mero-react
   * resolves it; an account cannot `listApplications`, and has no "installed"
   * set to consult). `null` until the provider has it. On a node it is `null`
   * here: the node path resolves the id the way it always has, from the URL /
   * stored / build-time value in `constants/config.ts`.
   */
  applicationId: string | null;
}

let _instance: ChatClient | null = null;

export function setMeroJs(instance: ChatClient | null): void {
  _instance = instance;
}

export function getMeroJs(): ChatClient {
  if (!_instance) {
    // MeroProvider hands us the instance as soon as it has a node URL; a null
    // instance means we are not connected/authenticated yet.
    throw new Error(
      getNodeUrl()
        ? "Mero client is not ready yet. Please retry in a moment."
        : "Application endpoint key is missing. Please check your configuration.",
    );
  }
  return _instance;
}

/**
 * Whether the current session is an account's, without throwing when there is
 * no session yet. For hiding controls that have no account form (a node's
 * local `deleteContext`, installing an application, device lists); anything
 * that performs a call goes through `getMeroJs()`.
 */
export function isDelegatedSession(): boolean {
  return _instance?.isDelegated ?? false;
}

export type LegacyRpcResult<T> =
  | {
      result: { output: T };
      error?: undefined;
    }
  | {
      result?: undefined;
      error: {
        code: number;
        message: string;
        error: { cause: { info: { message: string } } };
      };
    };

export async function rpcExec<T>(
  params: ExecuteParams,
  // Old SDK accepted a 2nd `config` arg (headers/timeout). mero-js owns
  // those at the HttpClient level, so this is accepted-and-ignored to
  // keep call sites identical.
  _config?: unknown,
): Promise<LegacyRpcResult<T>> {
  try {
    const output = await getMeroJs().rpc.execute<T>(params);
    return { result: { output } };
  } catch (e: unknown) {
    if (e instanceof RpcError) {
      // Server-side WASM errors used to surface as
      // `error.error.cause.info.message`. Reconstruct that path so existing
      // dataSource code finds its message in the same place.
      const data = e.data as
        { cause?: { info?: { message?: string } } } | undefined;
      const causeMessage =
        data?.cause?.info?.message ?? e.message ?? "RPC error";
      return {
        error: {
          code: e.code,
          message: e.message,
          error: { cause: { info: { message: causeMessage } } },
        },
      };
    }
    const message = e instanceof Error ? e.message : String(e);
    return {
      error: {
        code: -1,
        message,
        error: { cause: { info: { message } } },
      },
    };
  }
}

// The blob surface lives in ./blobs — one module owning the rc.39 discovery
// contract, the hex id form and the 35s budget. Re-exported here because six
// call sites already import `downloadBlob` from this file and the signature is
// unchanged; new code should import from "./blobs" directly.
export {
  downloadBlob,
  uploadBlob,
  blobInfo,
  deleteBlob,
  blobUrl,
  isUsableBlobId,
  toBlobIdHex,
  BLOB_READ_TIMEOUT_MS,
  BlobContextRequiredError,
} from "./blobs";

// ─── nodeApi shim ────────────────────────────────────────────────────────────
// Mimics calimero-client's `apiClient.node().X()` surface so call sites can
// just swap their import path. Each wrapper re-shapes mero-js's throw-on-error
// API back into the legacy `ResponseData<T>` envelope curb expects.

type LegacyError = { code: number; message: string };

function toLegacyError(e: unknown): LegacyError {
  return {
    code: (e as { code?: number })?.code ?? 500,
    message: e instanceof Error ? e.message : String(e),
  };
}

// `apiClient.node().createNewIdentity()` returned `{ publicKey, privateKey }`.
// mero-js's `generateContextIdentity()` no longer exposes the private key
// server-side — only `publicKey` is returned. We surface `privateKey: ""`
// for type compatibility with old callers that destructure both.
export type LegacyNodeIdentity = { publicKey: string; privateKey: string };

export type LegacyFetchContextIdentitiesResponse = {
  data: { identities: string[] };
};

export const nodeApi = {
  async getContext(contextId: string): Promise<ResponseData<Context>> {
    try {
      const data = await getMeroJs().admin.getContext(contextId);
      return { data };
    } catch (e) {
      return { error: toLegacyError(e) };
    }
  },

  async fetchContextIdentities(
    contextId: string,
  ): Promise<ResponseData<LegacyFetchContextIdentitiesResponse>> {
    try {
      // Old endpoint was `/identities-owned` — preserve that semantic
      // (returns only identities this node controls, not all members). On an
      // account the admin answers with the account's own identity in the
      // context, which is the same question.
      const result =
        await getMeroJs().admin.getContextIdentitiesOwned(contextId);
      // Old shape was double-wrapped: `{ data: { identities } }`. Match it.
      return { data: { data: { identities: result.identities ?? [] } } };
    } catch (e) {
      return { error: toLegacyError(e) };
    }
  },

  async createNewIdentity(): Promise<ResponseData<LegacyNodeIdentity>> {
    try {
      // Node-only: an account has no local key store to mint into, and the
      // account admin refuses this by name (`NotForAccountError`).
      const result = await getMeroJs().admin.generateContextIdentity();
      // Server no longer returns privateKey; expose empty string for shape
      // compatibility — downstream code reads `.publicKey` for executor.
      return { data: { publicKey: result.publicKey, privateKey: "" } };
    } catch (e) {
      return { error: toLegacyError(e) };
    }
  },
};
