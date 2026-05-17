import type { ApiResponse } from "./types";
import type { UserId } from "./clientApi";

export interface CreateContextProps {
  user: UserId;
  groupId?: string;
  /** Hex-encoded 32-byte private key for group context creation. Optional — the node derives it from its group identity when omitted. */
  identitySecret?: string;
  /** Human-readable name persisted in the context's MetadataRecord (post-054a784f). */
  name?: string;
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
  isSynced: boolean;
}

export interface CreateIdentityResponse {
  publicKey: string;
}

export interface DeleteContextProps {
  contextId: string;
}

export interface ContextInfo {
  contextId: string;
  applicationId: string;
  lastUpdate: number;
  rootHash: string;
}

export interface NodeApi {
  createContext(props: CreateContextProps): ApiResponse<CreateContextResponse>;
  deleteContext(props: DeleteContextProps): ApiResponse<string>;
  joinContext(props: JoinContextProps): ApiResponse<string>;
  verifyContext(props: VerifyContextProps): ApiResponse<VerifyContextResponse>;
  createIdentity(): ApiResponse<CreateIdentityResponse>;
  listContexts(): ApiResponse<ContextInfo[]>;
}
