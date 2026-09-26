import axios from "axios";
import { getNodeUrl as getAppEndpointKey } from "@calimero-network/mero-react";
import { getAuthConfig, getMeroJs } from "../meroJsClient";
import type { CreateContextRequest } from "@calimero-network/mero-react";
import type { ApiResponse } from "../types";
import { getApplicationId } from "../../constants/config";
import type {
  CreateContextProps,
  CreateContextResponse,
  CreateIdentityResponse,
  DeleteContextProps,
  JoinContextProps,
  NodeApi,
  VerifyContextProps,
  VerifyContextResponse,
} from "../nodeApi";

const DEFAULT_NODE_ENDPOINT = "http://localhost:2428";

/**
 * mero-js throws on a non-2xx instead of returning a status, so every migrated
 * call funnels its error through here to keep the `ApiResponse` envelope the
 * data sources have always returned. `status` is carried when the SDK supplies
 * one (HTTPError), so callers that branch on 404 keep working.
 */
function sdkError(context: string, error: unknown) {
  const code = (error as { status?: number })?.status ?? 500;
  const message =
    error instanceof Error
      ? error.message
      : `An unexpected error occurred during ${context}`;
  console.error(`${context} failed:`, error);
  return { data: null, error: { code, message } } as const;
}

// Helper function to get auth headers
function getAuthHeaders() {
  const authConfig = getAuthConfig();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (authConfig?.jwtToken) {
    headers["Authorization"] = `Bearer ${authConfig.jwtToken}`;
  }

  return headers;
}

export class ContextApiDataSource implements NodeApi {
  async createContext(
    props: CreateContextProps,
  ): ApiResponse<CreateContextResponse> {
    try {
      const jsonData = {
        name: props.user,
        is_dm: true,
        default_channels: [{ name: "private_dm" }],
        created_at: Date.now(),
      };
      const jsonString = JSON.stringify(jsonData);
      const encoder = new TextEncoder();
      const bytes = encoder.encode(jsonString);
      const byteArray = Array.from(bytes);

      if (!props.groupId) {
        throw new Error("createContext needs a groupId: every context lives in a group");
      }
      // Typed, never cast: core's CreateContextRequest is `deny_unknown_fields`,
      // so a stray key (it was `protocol`) refuses the whole create with a 400.
      const body: CreateContextRequest = {
        applicationId: getApplicationId(),
        groupId: props.groupId,
        initializationParams: byteArray,
        ...(props.identitySecret ? { identitySecret: props.identitySecret } : {}),
        // Stored in the context's MetadataRecord.
        ...(props.name ? { name: props.name } : {}),
      };
      const data = await getMeroJs().admin.createContext(body);
      return { data, error: null };
    } catch (error) {
      console.error("createContext failed:", error);
      let errorMessage = "An unexpected error occurred during createContext";
      if (error instanceof Error) {
        errorMessage = error.message;
      }
      return {
        data: null,
        error: {
          code: 500,
          message: errorMessage,
        },
      };
    }
  }

  async joinContext(props: JoinContextProps): ApiResponse<string> {
    try {
      // NOT MIGRATED — the endpoint no longer exists. core 40639c13
      // ("remove per-context join/invite/visibility/allowlist, groups-only
      // model") deleted POST /contexts/join along with context-level
      // invitations. mero-js's `joinContext(contextId)` is a different
      // operation: it posts to /contexts/{id}/join to subscribe to a context
      // you already have group access to.
      //
      // The replacement flow is joinGroup (join the namespace via a group
      // invitation) followed by joinGroupContext (subscribe to the context),
      // both already implemented in groupApiDataSource. This method has no
      // callers left in the app; it is kept only to satisfy the NodeApi
      // interface and should be removed with it.
      const nodeEndpoint = getAppEndpointKey() || DEFAULT_NODE_ENDPOINT;
      const response = await axios.post(
        `${nodeEndpoint}/admin-api/contexts/join`,
        {
          invitationPayload: props.invitationPayload,
        },
        {
          headers: getAuthHeaders(),
        },
      );

      if (response.status === 200) {
        return {
          data: response.data.data,
          error: null,
        };
      } else {
        return {
          data: null,
          error: {
            code: response.status,
            message: response.statusText,
          },
        };
      }
    } catch (error) {
      console.error("joinContext failed:", error);
      let errorMessage = "An unexpected error occurred during joinContext";
      if (error instanceof Error) {
        errorMessage = error.message;
      }
      return {
        data: null,
        error: {
          code: 500,
          message: errorMessage,
        },
      };
    }
  }

  async verifyContext(
    props: VerifyContextProps,
  ): ApiResponse<VerifyContextResponse> {
    try {
      // Core renamed `rootHash` to `contextStateHash`; the old key never
      // populated, so `joined` was permanently false and `isSynced`
      // permanently true. Read the field core actually sends.
      const ctx = await getMeroJs().admin.getContext(props.contextId);
      return {
        data: {
          joined: !!ctx.contextStateHash,
          isSynced: ctx.contextStateHash !== "11111111111111111111111111111111",
        },
        error: null,
      };
    } catch (error) {
      return sdkError("verifyContext", error);
    }
  }

  async createIdentity(): ApiResponse<CreateIdentityResponse> {
    try {
      const data = await getMeroJs().admin.generateContextIdentity();
      return { data, error: null };
    } catch (error) {
      return sdkError("createIdentity", error);
    }
  }

  async deleteContext(props: DeleteContextProps): ApiResponse<string> {
    try {
      // Path only — no body. `requester` used to ride along here, and rc.38
      // closed the body: `delete_context` takes `Path(context_id)` and nothing
      // else, so any key sent is a 422 rather than an ignored extra. The gate
      // is the caller's token now, not a field the caller names.
      const data = await getMeroJs().admin.deleteContext(props.contextId);
      return { data, error: null } as unknown as {
        data: string;
        error: null;
      };
    } catch (error) {
      return sdkError("deleteContext", error);
    }
  }

  async createGroupContext(params: {
    applicationId: string;
    groupId: string;
    initializationParams: Record<string, unknown>;
    identitySecret?: string;
    /** Human display name stored in the context's MetadataRecord. Capped
     *  at 64 bytes server-side; omit for DM contexts. */
    name?: string;
  }): ApiResponse<CreateContextResponse> {
    try {
      const jsonString = JSON.stringify(params.initializationParams);
      const byteArray = Array.from(new TextEncoder().encode(jsonString));

      // Typed, never cast. core's CreateContextRequest is closed: `protocol`
      // and `alias` were each a 400 ("unknown field `protocol`"), so no
      // channel, public or private, could be created. A DM's routing alias
      // lives on its subgroup's `groupName`, not here.
      const body: CreateContextRequest = {
        applicationId: params.applicationId,
        groupId: params.groupId,
        initializationParams: byteArray,
        ...(params.identitySecret ? { identitySecret: params.identitySecret } : {}),
        // Human-readable display name (server-capped at 64 bytes).
        ...(params.name ? { name: params.name } : {}),
      };
      const data = await getMeroJs().admin.createContext(body);
      return { data, error: null };
    } catch (error) {
      return sdkError("createGroupContext", error);
    }
  }

  async listContexts(): ApiResponse<import("../nodeApi").ContextInfo[]> {
    try {
      const { contexts: rawContexts = [] } =
        await getMeroJs().admin.getContexts();

      // Core's wire key is `contextStateHash`; `rootHash` never populated, so
      // the sync indicator in ContextSwitcher was stuck. Keep the field name
      // the ContextInfo interface exposes, fed from the key core sends.
      const contexts = rawContexts.map((ctx) => ({
        contextId: ctx.id,
        applicationId: ctx.applicationId,
        lastUpdate: 0,
        rootHash: ctx.contextStateHash,
      }));

      return { data: contexts, error: null };
    } catch (error) {
      console.error("listContexts failed:", error);
      let errorMessage = "An unexpected error occurred while fetching contexts";
      if (error instanceof Error) {
        errorMessage = error.message;
      }
      return {
        data: null,
        error: { code: 500, message: errorMessage },
      };
    }
  }
}
