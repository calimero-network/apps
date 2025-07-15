import type { ApiResponse } from "@calimero-network/calimero-client";
import type { UserId } from "./clientApi";

export interface CreateContextProps {
  user: UserId;
}

export interface CreateContextResponse {
    contextId: string;
    memberPublicKey: UserId;
}

export interface InviteToContextProps {
  contextId: string;
  invitee: UserId;
  inviter: UserId;
}

export interface JoinContextProps {
  invitationPayload: string;
}

export interface VerifyContextProps {
  contextId: string;
}

export interface VerifyContextResponse {
  joined: boolean;
}

export interface NodeApi {
  createContext(props: CreateContextProps): ApiResponse<CreateContextResponse>;
  inviteToContext(props: InviteToContextProps): ApiResponse<string>;
  joinContext(props: JoinContextProps): ApiResponse<string>;
  verifyContext(props: VerifyContextProps): ApiResponse<VerifyContextResponse>;
}
