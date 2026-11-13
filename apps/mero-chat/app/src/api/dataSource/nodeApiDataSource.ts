// v1's context API on Calimero 1.0: a context is an app instance of chat in
// the workspace's org (see `../platform.ts`), the identity in it the account.
import { describeError } from "@calimero-apps/connect";

import { getAccountId } from "../calimero";
import { createChatApp, deleteChannel, getAppRecord, listChatApps } from "../platform";
import type { ApiResponse } from "../types";
import type {
  CreateContextProps,
  CreateContextResponse,
  CreateIdentityResponse,
  DeleteContextProps,
  NodeApi,
  VerifyContextProps,
  VerifyContextResponse,
} from "../nodeApi";

function sdkError(context: string, error: unknown) {
  const code = (error as { status?: number })?.status ?? 500;
  console.error(`${context} failed:`, error);
  return { data: null, error: { code, message: describeError(error) } } as const;
}

export class ContextApiDataSource implements NodeApi {
  /** A DM-shaped instance named `props.name` in the workspace `props.groupId`. */
  async createContext(props: CreateContextProps): ApiResponse<CreateContextResponse> {
    try {
      if (!props.groupId) {
        throw new Error("createContext needs a groupId: every conversation lives in a workspace");
      }
      const contextId = await createChatApp(props.groupId, props.name, {
        name: props.name ?? props.user,
        context_type: "Dm",
      });
      return { data: { contextId, memberPublicKey: getAccountId() }, error: null };
    } catch (error) {
      return sdkError("createContext", error);
    }
  }

  /** Whether this account reaches the instance. There is nothing to sync. */
  async verifyContext(props: VerifyContextProps): ApiResponse<VerifyContextResponse> {
    try {
      await getAppRecord(props.contextId);
      return { data: { joined: true, isSynced: true }, error: null };
    } catch (error) {
      return sdkError("verifyContext", error);
    }
  }

  /** The identity is the account; there is no per-context key to mint. */
  async createIdentity(): ApiResponse<CreateIdentityResponse> {
    const publicKey = getAccountId();
    if (!publicKey) return { data: null, error: { code: 401, message: "Sign in first." } };
    return { data: { publicKey }, error: null };
  }

  /** Deletes a channel or DM: its team, which takes the instance (a passkey step-up). */
  async deleteContext(props: DeleteContextProps): ApiResponse<string> {
    try {
      await deleteChannel(props.contextId);
      return { data: props.contextId, error: null };
    } catch (error) {
      return sdkError("deleteContext", error);
    }
  }

  /**
   * The instance of a channel or DM: `groupId` is the pending channel
   * `GroupApiDataSource.createSubgroup` returned (or a workspace), and
   * `initializationParams` are v1's init arguments, passed to `init`.
   */
  async createGroupContext(params: {
    applicationId: string;
    groupId: string;
    initializationParams: Record<string, unknown>;
    identitySecret?: string;
    name?: string;
  }): ApiResponse<CreateContextResponse> {
    try {
      const contextId = await createChatApp(params.groupId, params.name, params.initializationParams);
      return { data: { contextId, memberPublicKey: getAccountId() }, error: null };
    } catch (error) {
      return sdkError("createGroupContext", error);
    }
  }

  /** Every chat instance this account reaches. */
  async listContexts(): ApiResponse<import("../nodeApi").ContextInfo[]> {
    try {
      const apps = await listChatApps();
      return {
        data: apps.map((a) => ({
          contextId: a.appId,
          applicationId: a.package ?? a.bundle,
          lastUpdate: 0,
          rootHash: "",
        })),
        error: null,
      };
    } catch (error) {
      return sdkError("listContexts", error);
    }
  }
}
