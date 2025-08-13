import { type ApiResponse } from '@calimero-network/calimero-client';

export type UserId = string;

export enum ClientMethod {
  CREATE_SIGNATURE = 'create_signature',
  DELETE_SIGNATURE = 'delete_signature',
  LIST_SIGNATURES = 'list_signatures',
  GET_SIGNATURE_DATA = 'get_signature_data',
  JOIN_SHARED_CONTEXT = 'join_shared_context',
  LIST_JOINED_CONTEXTS = 'list_joined_contexts',
  LEAVE_SHARED_CONTEXT = 'leave_shared_context',
  UPLOAD_DOCUMENT = 'upload_document',
  DELETE_DOCUMENT = 'delete_document',
  LIST_DOCUMENTS = 'list_documents',
  SIGN_DOCUMENT = 'sign_document',
  GET_DOCUMENT_SIGNATURES = 'get_document_signatures',
  MARK_DOCUMENT_FULLY_SIGNED = 'mark_document_fully_signed',
  GET_CONTEXT_DETAILS = 'get_context_details',
  ADD_PARTICIPANT = 'add_participant',
  MARK_PARTICIPANT_SIGNED = 'mark_participant_signed',
  IS_DEFAULT_PRIVATE_CONTEXT = 'is_default_private_context',
}

export interface SignatureRecord {
  id: number;
  name: string;
  blob_id: string;
  size: number;
  created_at: number;
}

export interface SavedSignature {
  id: number;
  name: string;
  dataURL: string;
  createdAt: string;
  size: number;
}

export interface ContextMetadata {
  context_id: string;
  context_name: string;
  role: string;
  joined_at: number;
  private_identity: UserId;
  shared_identity: UserId;
}

export enum DocumentStatus {
  Pending = 'Pending',
  PartiallySigned = 'PartiallySigned',
  FullySigned = 'FullySigned',
}

export enum PermissionLevel {
  Read = 'Read',
  Sign = 'Sign',
  Admin = 'Admin',
}

export interface ParticipantInfo {
  user_id: UserId;
  permission_level: PermissionLevel;
}

export interface ContextDetails {
  context_id: string;
  context_name: string;
  owner: UserId;
  is_private: boolean;
  participant_count: number;
  participants: ParticipantInfo[];
  document_count: number;
  created_at: number;
}

export interface DocumentInfo {
  id: string;
  name: string;
  hash: string;
  uploaded_by: UserId;
  uploaded_at: number;
  status: DocumentStatus;
  pdf_blob_id: string;
  size: number;
}

export interface Document {
  id: string;
  name: string;
  size: string;
  uploadedAt: string;
  status: DocumentStatus;
  uploadedBy: UserId;
  hash: string;
  pdfBlobId: string;
  file?: File;
}

export interface Agreement {
  id: string;
  name: string;
  contextId: string;
  memberPublicKey: UserId;
  role: string;
  joinedAt: number;
  privateIdentity: UserId;
  sharedIdentity: UserId;
}

export interface ClientApi {
  createSignature(
    name: string,
    blobIdStr: string,
    dataSize: number,
  ): ApiResponse<number>;
  deleteSignature(signatureId: number): ApiResponse<void>;
  listSignatures(): ApiResponse<SignatureRecord[]>;

  joinSharedContext(
    contextId: string,
    sharedIdentity: UserId,
    name: string,
  ): ApiResponse<void>;
  listJoinedContexts(): ApiResponse<ContextMetadata[]>;
  leaveSharedContext(contextId: string): ApiResponse<void>;
  getContextDetails(
    contextId: string,
    agreementContextID?: string,
    agreementContextUserID?: string,
  ): ApiResponse<ContextDetails>;

  uploadDocument(
    contextId: string,
    name: string,
    hash: string,
    pdfBlobIdStr: string,
    fileSize: number,
    agreementContextID?: string,
    agreementContextUserID?: string,
  ): ApiResponse<string>;
  deleteDocument(
    contextId: string,
    documentId: string,
    agreementContextID?: string,
    agreementContextUserID?: string,
  ): ApiResponse<void>;
  listDocuments(
    contextId: string,
    agreementContextID?: string,
    agreementContextUserID?: string,
  ): ApiResponse<DocumentInfo[]>;
  signDocument(
    contextId: string,
    documentId: string,
    pdfBlobIdStr: string,
    fileSize: number,
    newHash: string,
    signerId: string,
    agreementContextID?: string,
    agreementContextUserID?: string,
  ): ApiResponse<void>;
  addParticipant(
    contextId: string,
    userId: UserId,
    permission: PermissionLevel,
    agreementContextID?: string,
    agreementContextUserID?: string,
  ): ApiResponse<void>;
  isDefaultPrivateContext(): ApiResponse<boolean>;
}
