import axios from "axios";
import {
  getAppEndpointKey,
  type ApiResponse,
} from "@calimero-network/calimero-client";
import type {
  CreateContextProps,
  CreateContextResponse,
  CreateIdentityResponse,
  DeleteContextProps,
  InviteToContextProps,
  JoinContextProps,
  NodeApi,
  VerifyContextProps,
  VerifyContextResponse,
} from "../nodeApi";

const DEFAULT_NODE_ENDPOINT = "http://localhost:2428";

export class ContextApiDataSource implements NodeApi {
  async createContext(
    props: CreateContextProps
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

      const response = await axios.post(`${nodeEndpoint}/admin-api/contexts`, {
        applicationId: import.meta.env.VITE_APPLICATION_ID || "",
        protocol: "near",
        initializationParams: byteArray,
      });

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

  async inviteToContext(props: InviteToContextProps): ApiResponse<string> {
    try {
      const nodeEndpoint = getAppEndpointKey() || DEFAULT_NODE_ENDPOINT;
      const response = await axios.post(
        `${nodeEndpoint}/admin-api/contexts/invite`,
        {
          contextId: props.contextId,
          inviterId: props.inviter,
          inviteeId: props.invitee,
        }
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
      console.error("inviteToContext failed:", error);
      let errorMessage = "An unexpected error occurred during inviteToContext";
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
        }
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
    props: VerifyContextProps
  ): ApiResponse<VerifyContextResponse> {
    try {
      const nodeEndpoint = getAppEndpointKey() || DEFAULT_NODE_ENDPOINT;
      const response = await axios.get(
        `${nodeEndpoint}/admin-api/contexts/${props.contextId}`
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
        `${nodeEndpoint}/admin-api/identity/context`
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
        `${nodeEndpoint}/admin-api/contexts/${props.contextId}`
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
}
