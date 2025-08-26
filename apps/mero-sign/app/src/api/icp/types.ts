// Backend Result types
export type BackendResult<T> = { Ok: T } | { Err: Error };

export interface Error {
  InvalidInput?: string;
  NotFound?: null;
  AlreadyExists?: null;
  UpdateConflict?: string;
  Unauthorized?: null;
  DocumentNotReady?: null;
  ConsentRequired?: null;
  ContextNotFound?: null;
}

// Context types
export interface ContextRecord {
  context_id: string;
  admin_id: string;
  participants: string[];
  document_ids: string[];
  context_status: ContextStatus;
  metadata: ContextMetadata;
  created_at: bigint;
}

export interface ContextMetadata {
  title: string | null;
  description: string | null;
  agreement_type: string | null;
  expires_at: bigint | null;
}

export enum ContextStatus {
  Active = 'Active',
  Completed = 'Completed',
  Expired = 'Expired',
}

// Document types
export interface DocumentRecord {
  document_id: string;
  context_id: string;
  original_hash: string;
  timestamp_original: bigint;
  final_hash: string | null;
  timestamp_final: bigint | null;
  current_signers: string[];
  document_status: DocumentStatus;
  metadata: DocumentMetadata;
}

export interface DocumentMetadata {
  title: string | null;
  description: string | null;
  document_type: string | null;
  created_at: bigint;
}

export enum DocumentStatus {
  Pending = 'Pending',
  PartiallySigned = 'PartiallySigned',
  FullySigned = 'FullySigned',
}

// Audit types
export interface AuditEntry {
  entry_id: string;
  user_id: string;
  action: AuditAction;
  timestamp: bigint;
  context_id: string;
  document_id: string | null;
  consent_given: boolean | null;
  document_hash_after_action: string | null;
  metadata: string | null;
}

export enum AuditAction {
  ContextCreated = 'ContextCreated',
  ParticipantAdded = 'ParticipantAdded',
  DocumentUploaded = 'DocumentUploaded',
  ConsentGiven = 'ConsentGiven',
  SignatureApplied = 'SignatureApplied',
  DocumentCompleted = 'DocumentCompleted',
  ContextCompleted = 'ContextCompleted',
}

// Request types
export interface CreateContextRequest {
  context_id: string;
  participants: string[];
  title: string | null;
  description: string | null;
  agreement_type: string | null;
  expires_at: bigint | null;
}

export interface DocumentUploadRequest {
  context_id: string;
  document_id: string;
  document_hash: string;
}

export interface SigningRequest {
  document_id: string;
  consent_acknowledged: boolean;
}

// Additional request types for enhanced functionality
export interface ConsentRequest {
  context_id: string;
  document_id: string;
}

export interface UserConsentQuery {
  context_id: string;
  user_id: string;
  document_id: string;
}

// Verification types
export enum VerificationStatus {
  Unrecorded = 'Unrecorded',
  OriginalMatch = 'OriginalMatch',
  FinalMatch = 'FinalMatch',
  NoMatch = 'NoMatch',
}

// Enhanced response types
export interface DocumentConsentStatus {
  [documentId: string]: boolean;
}

export interface DocumentSigningStatus {
  [documentId: string]: {
    consented: boolean;
    signed: boolean;
    canSign: boolean;
  };
}

export interface SigningProgress {
  requiredSigners: string[];
  consentedUsers: string[];
  documentStatuses: Array<[string, DocumentStatus]>;
}

export interface ContextOverview {
  context: ContextRecord;
  documents: DocumentRecord[];
  signingProgress: SigningProgress;
  userStatuses: Record<string, DocumentSigningStatus>;
}

export interface AuditTrailResponse {
  entries: Array<AuditEntry & { timestampDate: Date }>;
  total: number;
}

// Utility types for better type safety
export interface DocumentHashes {
  original: { hash: string; timestamp: Date };
  final?: { hash: string; timestamp: Date };
}

export interface HashVerificationResult {
  status: VerificationStatus;
  isValid: boolean;
  matchType?: 'original' | 'final';
}

export interface UserSigningEligibility {
  canSign: boolean;
  reason?: string;
}

export interface ServiceResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

// Action result types
export interface ConsentResult {
  success: boolean;
  error?: string;
}

export interface SigningResult {
  success: boolean;
  error?: string;
}

// Extended metadata types for better UX
export interface DocumentWithStatus extends DocumentRecord {
  isFullySigned: boolean;
  isExpired: boolean;
  requiredSignersCount: number;
  currentSignersCount: number;
  signingProgress: number; // percentage
}

export interface ContextWithProgress extends ContextRecord {
  totalDocuments: number;
  completedDocuments: number;
  progressPercentage: number;
  isExpired: boolean;
}
