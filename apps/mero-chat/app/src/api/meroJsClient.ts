// The data layer's entry to the contract and to the few "node" questions the
// screens still ask, kept under the names v1's dataSource code calls.
//
// v1 routed every call through mero-react's `admin` + JSON-RPC `execute`. On
// Calimero 1.0 a contract call is `CalimeroClient.call`/`view` on an app
// instance, which `./meroChat` wraps (v1 method names and shapes in and out).
// `rpcExec` keeps the old `{ result: { output } } | { error }` envelope, so
// `ClientApiDataSource` is unchanged.
import { getAccountId, getClient } from "./calimero";
import { ChatError, execute } from "./meroChat";
import type { ResponseData } from "./types";

/** What `ClientApiDataSource` hands `rpcExec` (v1's `ExecuteParams`). */
export interface ExecuteParams {
  contextId: string;
  method: string;
  argsJson?: Record<string, unknown>;
  /** v1's per-context member key. Ignored: the signed-in account is the caller. */
  executorPublicKey?: string;
}

/**
 * True: every session is an account's. Controls that only a node operator had
 * (deleting a context on this node, installing an application, device lists)
 * stay hidden, as they did for v1 account sessions.
 */
export function isDelegatedSession(): boolean {
  return true;
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
  // v1 took a `{ headers, timeout }` config here; mero-js owns both now.
  _config?: unknown,
): Promise<LegacyRpcResult<T>> {
  try {
    const output = await execute<T>(params.contextId, params.method, params.argsJson ?? {});
    return { result: { output } };
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    const code = e instanceof ChatError ? e.code : -1;
    return { error: { code, message, error: { cause: { info: { message } } } } };
  }
}

export {
  downloadBlob,
  uploadBlob,
  deleteBlob,
  isUsableBlobId,
  toBlobIdHex,
} from "./blobs";

// ─── nodeApi shim ────────────────────────────────────────────────────────────
// The "node" questions v1's screens asked, answered for an account.

type LegacyError = { code: number; message: string };

function toLegacyError(e: unknown): LegacyError {
  return {
    code: (e as { status?: number })?.status ?? 500,
    message: e instanceof Error ? e.message : String(e),
  };
}

export type LegacyNodeIdentity = { publicKey: string; privateKey: string };

export type LegacyFetchContextIdentitiesResponse = {
  data: { identities: string[] };
};

export const nodeApi = {
  /** The app instance's record (v1: the context). */
  async getContext(contextId: string): Promise<ResponseData<Record<string, unknown>>> {
    try {
      const data = await getClient().apps.get({ app: contextId });
      return { data };
    } catch (e) {
      return { error: toLegacyError(e) };
    }
  },

  /**
   * "Which identities of mine are in this context": the account, wherever it
   * reaches the app (v1 minted a member key per context).
   */
  async fetchContextIdentities(
    contextId: string,
  ): Promise<ResponseData<LegacyFetchContextIdentitiesResponse>> {
    try {
      await getClient().apps.get({ app: contextId });
      const account = getAccountId();
      return { data: { data: { identities: account ? [account] : [] } } };
    } catch (e) {
      return { error: toLegacyError(e) };
    }
  },

  /** There is no per-context key to mint: the identity is the account. */
  async createNewIdentity(): Promise<ResponseData<LegacyNodeIdentity>> {
    const account = getAccountId();
    if (!account) return { error: { code: 401, message: "Sign in first." } };
    return { data: { publicKey: account, privateKey: "" } };
  },
};
