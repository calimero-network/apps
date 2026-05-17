import axios from "axios";
import {
  getNodeUrl as getAppEndpointKey,
  getContextIdentity as getExecutorPublicKey,
} from "@calimero-network/mero-react";
import { getAuthConfig } from "../meroJsClient";
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

      const nodeEndpoint = getAppEndpointKey() || DEFAULT_NODE_ENDPOINT;

      const body: Record<string, unknown> = {
        applicationId: getApplicationId(),
        protocol: "near",
        initializationParams: byteArray,
      };
      if (props.groupId) {
        body.groupId = props.groupId;
      }
      if (props.identitySecret) {
        body.identitySecret = props.identitySecret;
      }
      if (props.name) {
        // Post-054a784f the context-create request accepts a `name`
        // field that is stored directly into the context's MetadataRecord.
        body.name = props.name;
      }

      const response = await axios.post(
        `${nodeEndpoint}/admin-api/contexts`,
        body,
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
      const nodeEndpoint = getAppEndpointKey() || DEFAULT_NODE_ENDPOINT;
      const response = await axios.get(
        `${nodeEndpoint}/admin-api/contexts/${props.contextId}`,
        {
          headers: getAuthHeaders(),
        },
      );

      if (response.status === 200) {
        return {
          data: {
            joined: response.data.data.rootHash ? true : false,
            isSynced:
              response.data.data.rootHash !==
              "11111111111111111111111111111111",
          },
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
      console.error("Error fetching context:", error);
      return {
        data: null,
        error: { code: 500, message: "Failed to fetch context data." },
      };
    }
  }

  async createIdentity(): ApiResponse<CreateIdentityResponse> {
    try {
      const nodeEndpoint = getAppEndpointKey() || DEFAULT_NODE_ENDPOINT;
      const response = await axios.post(
        `${nodeEndpoint}/admin-api/identity/context`,
        {},
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
          error: { code: response.status, message: response.statusText },
        };
      }
    } catch (error) {
      console.error("createIdentity failed:", error);
      let errorMessage = "An unexpected error occurred during createIdentity";
      if (error instanceof Error) {
        errorMessage = error.message;
      }
      return {
        data: null,
        error: { code: 500, message: errorMessage },
      };
    }
  }

  async deleteContext(props: DeleteContextProps): ApiResponse<string> {
    try {
      const nodeEndpoint = getAppEndpointKey() || DEFAULT_NODE_ENDPOINT;
      const response = await axios.delete(
        `${nodeEndpoint}/admin-api/contexts/${props.contextId}`,
        {
          headers: getAuthHeaders(),
          data: { requester: getExecutorPublicKey() },
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
          error: { code: response.status, message: response.statusText },
        };
      }
    } catch (error) {
      console.error("Delete context failed:", error);
      let errorMessage = "An unexpected error occurred during delete context";
      if (error instanceof Error) {
        errorMessage = error.message;
      }
      return {
        data: null,
        error: { code: 500, message: errorMessage },
      };
    }
  }

  async createGroupContext(params: {
    applicationId: string;
    protocol: string;
    groupId: string;
    initializationParams: Record<string, unknown>;
    identitySecret?: string;
    /** Routing alias — may be long (e.g. DM aliases). No length cap. */
    alias?: string;
    /** Human display name stored in the context's MetadataRecord. Capped
     *  at 64 bytes server-side; omit for DM contexts. */
    name?: string;
  }): ApiResponse<CreateContextResponse> {
    try {
      const nodeEndpoint = getAppEndpointKey() || DEFAULT_NODE_ENDPOINT;
      const jsonString = JSON.stringify(params.initializationParams);
      const byteArray = Array.from(new TextEncoder().encode(jsonString));

      const body: Record<string, unknown> = {
        applicationId: params.applicationId,
        protocol: params.protocol,
        groupId: params.groupId,
        initializationParams: byteArray,
      };
      if (params.identitySecret) {
        body.identitySecret = params.identitySecret;
      }
      // alias is the routing identifier (may be long for DM contexts).
      // name is the human-readable display (server-capped at 64 bytes).
      // Send only what was passed — never auto-derive name from alias.
      if (params.alias) body.alias = params.alias;
      if (params.name) body.name = params.name;

      const response = await axios.post(
        `${nodeEndpoint}/admin-api/contexts`,
        body,
        { headers: getAuthHeaders() },
      );

      if (response.status === 200) {
        return { data: response.data.data, error: null };
      } else {
        return {
          data: null,
          error: { code: response.status, message: response.statusText },
        };
      }
    } catch (error) {
      console.error("createGroupContext failed:", error);
      const errorMessage =
        error instanceof Error
          ? error.message
          : "An unexpected error occurred during createGroupContext";
      return { data: null, error: { code: 500, message: errorMessage } };
    }
  }

  async listContexts(): ApiResponse<import("../nodeApi").ContextInfo[]> {
    try {
      const nodeEndpoint = getAppEndpointKey() || DEFAULT_NODE_ENDPOINT;
      const response = await axios.get(`${nodeEndpoint}/admin-api/contexts`, {
        headers: getAuthHeaders(),
      });

      if (response.status === 200) {
        // The response structure is { data: { contexts: [...] } }
        const rawContexts =
          response.data.data?.contexts || response.data?.contexts || [];

        // Map the API response to our ContextInfo interface
        // API uses 'id' but our interface expects 'contextId'
        const contexts = rawContexts.map((ctx: { id: string; applicationId: string; lastUpdate?: number; rootHash?: string }) => ({
          contextId: ctx.id,
          applicationId: ctx.applicationId,
          lastUpdate: ctx.lastUpdate || 0,
          rootHash: ctx.rootHash,
        }));

        return {
          data: contexts,
          error: null,
        };
      } else {
        return {
          data: null,
          error: { code: response.status, message: response.statusText },
        };
      }
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
