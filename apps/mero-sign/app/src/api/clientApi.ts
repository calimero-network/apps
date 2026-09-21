import { type ApiResponse } from '../lib/node';

export type UserId = string;

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
import type {
  DocumentChunk,
  SignatureRecord,
} from '../generated/MeroSignClient';

export type { DocumentChunk, SignatureRecord };

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
    chunks?: DocumentChunk[],
    agreementContextID?: string,
    agreementContextUserID?: string,
  ): ApiResponse<string>;
  // ⚠️ `documentId` FIRST. This used to declare a leading `contextId` that the
  // implementation never had; both are strings, so the disagreement
  // type-checked and a second caller written from this line would have passed
  // a document id where a context id was read.
  deleteDocument(
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
