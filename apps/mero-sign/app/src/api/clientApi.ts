import { type ApiResponse } from '../lib/node';

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
  REGISTER_SELF_AS_PARTICIPANT = 'register_self_as_participant',
  REMOVE_PARTICIPANT = 'remove_participant',
  SET_PARTICIPANT_PERMISSION = 'set_participant_permission',
  WHOAMI = 'whoami',
  MARK_PARTICIPANT_SIGNED = 'mark_participant_signed',
  SET_CONSENT = 'set_consent',
  HAS_CONSENTED = 'has_consented',
  IS_DEFAULT_PRIVATE_CONTEXT = 'is_default_private_context',
  SEARCH_DOCUMENT_BY_EMBEDDING = 'search_document_by_embedding',
}

/**
 * ⚠️ RE-EXPORTED FROM THE GENERATED CLIENT, not declared here.
 *
 * The hand-written copy said `blob_id: string`. The ABI says BYTES, and the
 * generated client wraps them as `CalimeroBytes`. That one-word divergence is
 * the blob-id bug in type form: the app believed it held a string, so
 * `bs58.encode`-ing it looked correct, and the node answered "Failed to decode
 * blob ID (expected hex)" at runtime. Sourcing the type from the ABI makes
 * that a compile error instead.
 */
import type { SignatureRecord } from '../generated/MeroSignClient';

export type { SignatureRecord };

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
  embeddings?: number[]; // New: Vector embeddings from frontend
  extracted_text?: string; // New: Extracted text from PDF
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
  embeddings?: number[];
  extractedText?: string;
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

  // Contract expects: shared_identity_str (base58 public key string)
  joinSharedContext(
    contextId: string,
    sharedIdentityStr: UserId,
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
    embeddings?: number[],
    extractedText?: string,
    chunks?: any[],
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
  // The signer is the CALLER's account, derived inside the contract. There is
  // deliberately no signer parameter: the one that used to be here let any
  // member record a signature attributed to another member.
  signDocument(
    contextId: string,
    documentId: string,
    pdfBlobIdStr: string,
    fileSize: number,
    newHash: string,
    agreementContextID?: string,
    agreementContextUserID?: string,
  ): ApiResponse<void>;
  // Contract expects: user_id_str (base58 public key string)
  addParticipant(
    contextId: string,
    userIdStr: UserId,
    permission: PermissionLevel,
    agreementContextID?: string,
    agreementContextUserID?: string,
  ): ApiResponse<void>;
  // Consent is a personal act, so there is no user parameter: the contract
  // records it for the caller's account.
  setConsent(
    documentId: string,
    agreementContextID?: string,
    agreementContextUserID?: string,
  ): ApiResponse<void>;
  // A read, so it may ask about anyone. ⚠️ Contract expects a HEX ACCOUNT id —
  // use `whoami()` for your own, never the context member key.
  hasConsented(
    userIdStr: UserId,
    documentId: string,
    agreementContextID?: string,
    agreementContextUserID?: string,
  ): ApiResponse<boolean>;
  // Contract expects: user_id_str (HEX account id) — raising only; the contract
  // refuses a demotion because permissions merge by taking the higher rank.
  setParticipantPermission(
    userIdStr: UserId,
    permission: PermissionLevel,
    agreementContextID?: string,
    agreementContextUserID?: string,
  ): ApiResponse<void>;
  removeParticipant(
    userIdStr: UserId,
    agreementContextID?: string,
    agreementContextUserID?: string,
  ): ApiResponse<void>;
  /** The caller's ACCOUNT id, which the frontend cannot derive for itself. */
  whoami(
    agreementContextID?: string,
    agreementContextUserID?: string,
  ): ApiResponse<UserId>;
  isDefaultPrivateContext(): ApiResponse<boolean>;
  searchDocumentByEmbedding(
    queryEmbedding: number[],
    documentId: string,
    agreementContextID?: string,
    agreementContextUserID?: string,
  ): ApiResponse<string>;
}
