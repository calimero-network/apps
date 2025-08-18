// Types based on the Rust canister structs
export interface DocumentMetadata {
  title?: string;
  description?: string;
  document_type?: string;
  created_at: bigint;
  expires_at?: bigint;
}

export interface DocumentRecord {
  original_hash: string;
  timestamp_original: bigint;
  final_hash?: string;
  timestamp_final?: bigint;
  admin_id: string;
  participants: string[];
  current_signers: string[];
  document_status: DocumentStatus;
  metadata: DocumentMetadata;
}

export enum DocumentStatus {
  Pending = 'Pending',
  PartiallySigned = 'PartiallySigned',
  FullySigned = 'FullySigned',
}

export enum AuditAction {
  DocumentUploaded = 'DocumentUploaded',
  DocumentViewed = 'DocumentViewed',
  ConsentGiven = 'ConsentGiven',
  SignatureApplied = 'SignatureApplied',
  DocumentCompleted = 'DocumentCompleted',
  SignerAdded = 'SignerAdded',
}

export interface AuditEntry {
  entry_id: string;
  user_id: string;
  action: AuditAction;
  timestamp: bigint;
  consent_given?: boolean;
  document_hash_after_action?: string;
  metadata?: string;
}

export interface DocumentUploadRequest {
  document_id: string;
  document_hash: string;
  participants: string[];
  title?: string;
  description?: string;
  document_type?: string;
  expires_at?: bigint;
}

export interface SigningRequest {
  document_id: string;
  consent_acknowledged: boolean;
}

export enum VerificationStatus {
  Unrecorded = 'Unrecorded',
  OriginalMatch = 'OriginalMatch',
  FinalMatch = 'FinalMatch',
  NoMatch = 'NoMatch',
}

export enum ErrorType {
  InvalidInput = 'InvalidInput',
  NotFound = 'NotFound',
  AlreadyExists = 'AlreadyExists',
  UpdateConflict = 'UpdateConflict',
  Unauthorized = 'Unauthorized',
  DocumentNotReady = 'DocumentNotReady',
  ConsentRequired = 'ConsentRequired',
}

export interface BackendError {
  [key: string]: string | null;
}

export type BackendResult<T> = { Ok: T } | { Err: BackendError };
