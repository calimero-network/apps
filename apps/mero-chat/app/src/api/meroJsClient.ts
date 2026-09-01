// Accessor for MeroProvider's MeroJs instance + a thin RPC wrapper that
// preserves the old calimero-client
// `{ result: { output }, error: { code, error: { cause: { info } } } }`
// envelope shape, so dataSource code can keep its existing access patterns
// without per-callsite refactors.

// Everything comes from mero-react, including the mero-js surface it
// re-exports (`export * from "@calimero-network/mero-js"`).
//
// Importing mero-js directly would mean declaring it as a second dependency
// beside mero-react, which owns its own copy. Two copies is a correctness
// problem, not untidiness: they can resolve to different majors, and mero-js 14
// changed every id from base58 to hex. Two encodings inside one app, against
// a node that parses one, is the failure this app already hit.
import {
  type MeroJs,
  RpcError,
  type Context,
  type ExecuteParams,
  getNodeUrl,
} from "@calimero-network/mero-react";
import type { ResponseData } from "./types";

// Helper used by raw-fetch wrappers below + by useSseSubscription.
export function getJwt(): string {
  try {
    const raw = localStorage.getItem("mero-tokens");
    if (!raw) return "";
    const parsed = JSON.parse(raw) as { access_token?: string };
    return parsed?.access_token ?? "";
  } catch {
    return "";
  }
}

// The ONE MeroJs instance, owned by MeroProvider and handed to us by
// <MeroJsBridge> (see api/MeroJsBridge.tsx). We deliberately do not construct
// our own: mero-js's refresh single-flight is per-instance, so a second instance
// over the same `mero-tokens` bundle can double-spend a single-use refresh token
// (core#3083) and get the whole token family revoked.
let _instance: MeroJs | null = null;

export function setMeroJs(instance: MeroJs | null): void {
  _instance = instance;
}

export function getMeroJs(): MeroJs {
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
      const data = e.data as { cause?: { info?: { message?: string } } } | undefined;
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

// mero-js's `admin.getBlob` returns metadata (`{ blobId, size }`), not bytes.
// Curb needs the raw bytes for image previews and downloads — fetch them
// directly from the same endpoint the old `blobClient.downloadBlob` used.
export async function downloadBlob(
  blobId: string,
  contextId: string,
): Promise<Blob> {
  const baseUrl = getNodeUrl();
  if (!baseUrl) {
    throw new Error("Node URL is not set.");
  }
  const url = new URL(`/admin-api/blobs/${blobId}`, baseUrl);
  url.searchParams.set("context_id", contextId);

  const token = getJwt();

  const res = await fetch(url.toString(), {
    method: "GET",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    throw new Error(`downloadBlob failed: ${res.status} ${res.statusText}`);
  }
  return res.blob();
}

// Minimal replacement for calimero-client's `getAuthConfig`. Curb only ever
// reads `cfg?.jwtToken`, so we expose just that field. Reads from the same
// `mero:access_token` localStorage key MeroProvider writes to.
export function getAuthConfig(): { jwtToken: string } | null {
  const jwt = getJwt();
  return jwt ? { jwtToken: jwt } : null;
}

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

// `contextInviteByOpenInvitation` returned a signed invitation payload.
// Shape preserved from the old `nodeApi`.
export type LegacySignedOpenInvitation = {
  invitation: unknown;
  inviterSignature: string;
};

export type LegacyContextInviteByOpenInvitationResponse = LegacySignedOpenInvitation | null;

export type LegacyJoinContextResponse = {
  contextId: string;
  memberPublicKey: string;
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
      // (returns only identities this node controls, not all members).
      const result = await getMeroJs().admin.getContextIdentitiesOwned(contextId);
      // Old shape was double-wrapped: `{ data: { identities } }`. Match it.
      return { data: { data: { identities: result.identities ?? [] } } };
    } catch (e) {
      return { error: toLegacyError(e) };
    }
  },

  async createNewIdentity(): Promise<ResponseData<LegacyNodeIdentity>> {
    try {
      const result = await getMeroJs().admin.generateContextIdentity();
      // Server no longer returns privateKey; expose empty string for shape
      // compatibility — downstream code reads `.publicKey` for executor.
      return { data: { publicKey: result.publicKey, privateKey: "" } };
    } catch (e) {
      return { error: toLegacyError(e) };
    }
  },

  async contextInviteByOpenInvitation(
    contextId: string,
    inviterId: string,
    validForBlocks: number,
  ): Promise<ResponseData<LegacyContextInviteByOpenInvitationResponse>> {
    // No direct mero-js method — hit the same admin-api endpoint the old
    // SDK used. Group/namespace invitations have `createGroupInvitation`,
    // but per-context open invitations are still served by this legacy URL.
    const baseUrl = getNodeUrl();
    if (!baseUrl) {
      return { error: { code: 400, message: "Node URL is not set." } };
    }
    const token = getJwt();

    try {
      const res = await fetch(
        new URL("/admin-api/contexts/invite_by_open_invitation", baseUrl).toString(),
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ contextId, inviterId, validForBlocks }),
        },
      );
      if (!res.ok) {
        return {
          error: { code: res.status, message: `${res.status} ${res.statusText}` },
        };
      }
      const body = (await res.json()) as { data?: LegacyContextInviteByOpenInvitationResponse };
      return { data: body?.data ?? null };
    } catch (e) {
      return { error: toLegacyError(e) };
    }
  },

  async joinContextByOpenInvitation(
    invitation: LegacySignedOpenInvitation,
    newMemberPublicKey: string,
  ): Promise<ResponseData<LegacyJoinContextResponse>> {
    const baseUrl = getNodeUrl();
    if (!baseUrl) {
      return { error: { code: 400, message: "Node URL is not set." } };
    }
    const token = getJwt();

    try {
      const res = await fetch(
        new URL("/admin-api/contexts/join_by_open_invitation", baseUrl).toString(),
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ invitation, newMemberPublicKey }),
        },
      );
      if (!res.ok) {
        return {
          error: { code: res.status, message: `${res.status} ${res.statusText}` },
        };
      }
      const body = (await res.json()) as { data?: LegacyJoinContextResponse };
      if (!body?.data) {
        return { error: { code: 500, message: "Empty response from join endpoint" } };
      }
      return { data: body.data };
    } catch (e) {
      return { error: toLegacyError(e) };
    }
  },
};
