export interface ErrorResponse {
  code?: number | string;
  message: string;
}

export type ApiResponse<T> = Promise<
  { data: T; error: null } | { data: null; error: ErrorResponse }
>;

export type UserId = string;

/** A saved signature, as the screens read it (`createdAt` in ms). */
export interface SignatureRecord {
  id: number;
  name: string;
  /** The image's blob id, 64 hex. */
  blob_id: string;
  size: number;
  /** Milliseconds since the epoch. */
  created_at: number;
}

/** A chunk of a document's text and its embedding, for the legal assistant. */
export interface DocumentChunk {
  text: string;
  embedding: number[];
  start_position: number;
  end_position: number;
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
