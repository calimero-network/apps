/**
 * The contract, typed: every method of `logic/res/abi.json`, called by its
 * camelCase name through mero-js's `CalimeroClient`, with the answers turned
 * back into the snake_case, number-valued shapes the screens have always used
 * (`src/api/clientApi.ts`).
 *
 * What the wire looks like now (and what this file undoes):
 *
 * - method and argument names are camelCase (`uploadDocument`, `pdfBlobIdStr`);
 * - 64-bit integers are decimal strings (`size`, timestamps, signature ids,
 *   counts); timestamps are Unix MILLISECONDS (v1: nanoseconds);
 * - accounts are account-id strings and blob ids 64 lowercase hex digits (v1:
 *   32-byte arrays);
 * - a failed method is an `AppError` with `appCode` (`NotFound`, `Forbidden`,
 *   `Invalid`, `Conflict`) and `fields.message` carrying v1's sentence.
 *
 * Calls go through the app's log (`client.call`), views to a node
 * (`client.view`). `after` runs after every request: it keeps the stored
 * session current (refresh tokens are single-use).
 */

import {
  DocumentStatus,
  PermissionLevel,
  type ContextDetails,
  type ContextMetadata,
  type DocumentChunk,
  type DocumentInfo,
  type SignatureRecord,
} from '../api/clientApi';
import { type ClientRoutes } from '@calimero-apps/connect';

/** The calls (logged writes) the contract has, besides `init`. */
export const CALLS = [
  'setup',
  'createSignature',
  'deleteSignature',
  'joinSharedContext',
  'leaveSharedContext',
  'registerSelfAsParticipant',
  'addParticipant',
  'removeParticipant',
  'setParticipantPermission',
  'uploadDocument',
  'deleteDocument',
  'setConsent',
  'signDocument',
  'markParticipantSigned',
] as const;

/** The views (reads) the contract has. */
export const VIEWS = [
  'isDefaultPrivateContext',
  'listSignatures',
  'listJoinedContexts',
  'getIdentityMapping',
  'getSharedIdentity',
  'resolvePrivateIdentity',
  'whoami',
  'getContextId',
  'getContextDetails',
  'listParticipants',
  'getUserPermission',
  'listDocuments',
  'hasConsented',
  'getDocumentSignatures',
  'searchDocumentByEmbedding',
] as const;

export type Transport = ClientRoutes<{ apps: 'call' | 'view' }>;

// ── wire shapes ──────────────────────────────────────────────────────────────

export interface WireSignature {
  id: string;
  name: string;
  blobId: string;
  size: string;
  createdAt: string;
}

export interface WireContextMetadata {
  contextId: string;
  contextName: string;
  role: string;
  joinedAt: string;
  privateIdentity: string;
  sharedIdentity: string;
}

export interface WireIdentityMapping {
  privateIdentity: string;
  sharedIdentity: string;
  contextId: string;
  createdAt: string;
}

export interface WireDocumentInfo {
  id: string;
  name: string;
  hash: string;
  uploadedBy: string;
  uploadedAt: string;
  status: string;
  pdfBlobId: string;
  size: string;
  requiredSigners: string[];
  embeddings: number[] | null;
  extractedText: string | null;
  chunks: unknown[] | null;
}

export interface WireContextDetails {
  contextId: string;
  contextName: string;
  owner: string;
  isPrivate: boolean;
  participantCount: string;
  participants: { userId: string; permissionLevel: string }[];
  documentCount: string;
  createdAt: string;
}

export interface IdentityMapping {
  private_identity: string;
  shared_identity: string;
  context_id: string;
  created_at: number;
}

export interface DocumentSignature {
  signer: string;
  signed_at: number;
}

// ── converters ───────────────────────────────────────────────────────────────

const num = (v: string | number | null | undefined): number =>
  v === null || v === undefined || v === '' ? 0 : Number(v);

export function toSignature(s: WireSignature): SignatureRecord {
  return {
    id: num(s.id),
    name: s.name,
    blob_id: s.blobId,
    size: num(s.size),
    created_at: num(s.createdAt),
  };
}

export function toContextMetadata(c: WireContextMetadata): ContextMetadata {
  return {
    context_id: c.contextId,
    context_name: c.contextName,
    role: c.role,
    joined_at: num(c.joinedAt),
    private_identity: c.privateIdentity,
    shared_identity: c.sharedIdentity,
  };
}

export function toIdentityMapping(m: WireIdentityMapping): IdentityMapping {
  return {
    private_identity: m.privateIdentity,
    shared_identity: m.sharedIdentity,
    context_id: m.contextId,
    created_at: num(m.createdAt),
  };
}

export function toDocumentInfo(d: WireDocumentInfo): DocumentInfo {
  return {
    id: d.id,
    name: d.name,
    hash: d.hash,
    uploaded_by: d.uploadedBy,
    uploaded_at: num(d.uploadedAt),
    status: d.status as DocumentStatus,
    pdf_blob_id: d.pdfBlobId,
    size: num(d.size),
    required_signers: d.requiredSigners ?? [],
    embeddings: d.embeddings ?? undefined,
    extracted_text: d.extractedText ?? undefined,
  };
}

export function toContextDetails(d: WireContextDetails): ContextDetails {
  return {
    context_id: d.contextId,
    context_name: d.contextName,
    owner: d.owner,
    is_private: d.isPrivate,
    participant_count: num(d.participantCount),
    participants: (d.participants ?? []).map((p) => ({
      user_id: p.userId,
      permission_level: p.permissionLevel as PermissionLevel,
    })),
    document_count: num(d.documentCount),
    created_at: num(d.createdAt),
  };
}

function toWireChunk(c: DocumentChunk) {
  return {
    text: c.text,
    embedding: c.embedding,
    startPosition: c.start_position,
    endPosition: c.end_position,
  };
}

// ── the client ───────────────────────────────────────────────────────────────

/** One app instance of the contract: a private library or a shared agreement. */
export class MeroSignApp {
  constructor(
    private readonly transport: Transport,
    readonly appId: string,
    private readonly after: () => void = () => {},
  ) {}

  private async call<T>(method: (typeof CALLS)[number], args: Record<string, unknown> = {}): Promise<T> {
    try {
      return (await this.transport.apps.call({ app: this.appId, method, args })).result as T;
    } finally {
      this.after();
    }
  }

  private async view<T>(method: (typeof VIEWS)[number], args: Record<string, unknown> = {}): Promise<T> {
    try {
      return (await this.transport.apps.view({ app: this.appId, method, args })).result as T;
    } finally {
      this.after();
    }
  }

  // setup
  setup(a: { is_private: boolean; context_name: string }): Promise<void> {
    return this.call('setup', { isPrivate: a.is_private, contextName: a.context_name });
  }
  isDefaultPrivateContext(): Promise<boolean> {
    return this.view('isDefaultPrivateContext');
  }

  // private library
  async createSignature(a: { name: string; blob_id_str: string; data_size: number }): Promise<number> {
    return num(
      await this.call<string>('createSignature', {
        name: a.name,
        blobIdStr: a.blob_id_str,
        dataSize: String(a.data_size),
      }),
    );
  }
  deleteSignature(a: { signature_id: number }): Promise<void> {
    return this.call('deleteSignature', { signatureId: String(a.signature_id) });
  }
  async listSignatures(): Promise<SignatureRecord[]> {
    return ((await this.view<WireSignature[]>('listSignatures')) ?? []).map(toSignature);
  }
  joinSharedContext(a: { context_id_str: string; shared_identity_str: string; context_name: string }): Promise<void> {
    return this.call('joinSharedContext', {
      contextIdStr: a.context_id_str,
      sharedIdentityStr: a.shared_identity_str,
      contextName: a.context_name,
    });
  }
  leaveSharedContext(a: { context_id_str: string }): Promise<void> {
    return this.call('leaveSharedContext', { contextIdStr: a.context_id_str });
  }
  async listJoinedContexts(): Promise<ContextMetadata[]> {
    return ((await this.view<WireContextMetadata[]>('listJoinedContexts')) ?? []).map(toContextMetadata);
  }
  async getIdentityMapping(a: { context_id_str: string }): Promise<IdentityMapping> {
    return toIdentityMapping(
      await this.view<WireIdentityMapping>('getIdentityMapping', { contextIdStr: a.context_id_str }),
    );
  }
  getSharedIdentity(a: { context_id_str: string }): Promise<string> {
    return this.view('getSharedIdentity', { contextIdStr: a.context_id_str });
  }
  resolvePrivateIdentity(a: { shared_identity_str: string }): Promise<string | null> {
    return this.view('resolvePrivateIdentity', { sharedIdentityStr: a.shared_identity_str });
  }

  // agreement: who
  whoami(): Promise<string> {
    return this.view('whoami');
  }
  getContextId(): Promise<string> {
    return this.view('getContextId');
  }
  async getContextDetails(a: { context_id_str: string }): Promise<ContextDetails> {
    return toContextDetails(
      await this.view<WireContextDetails>('getContextDetails', { contextIdStr: a.context_id_str }),
    );
  }
  listParticipants(): Promise<string[]> {
    return this.view('listParticipants');
  }
  getUserPermission(a: { user_id_str: string }): Promise<PermissionLevel> {
    return this.view('getUserPermission', { userIdStr: a.user_id_str });
  }
  registerSelfAsParticipant(): Promise<void> {
    return this.call('registerSelfAsParticipant');
  }
  addParticipant(a: { user_id_str: string; permission: PermissionLevel }): Promise<void> {
    return this.call('addParticipant', { userIdStr: a.user_id_str, permission: a.permission });
  }
  removeParticipant(a: { user_id_str: string }): Promise<void> {
    return this.call('removeParticipant', { userIdStr: a.user_id_str });
  }
  setParticipantPermission(a: { user_id_str: string; permission: PermissionLevel }): Promise<void> {
    return this.call('setParticipantPermission', { userIdStr: a.user_id_str, permission: a.permission });
  }

  // agreement: documents
  uploadDocument(a: {
    name: string;
    hash: string;
    pdf_blob_id_str: string;
    file_size: number;
    embeddings: number[] | null;
    extracted_text: string | null;
    chunks: DocumentChunk[] | null;
  }): Promise<string> {
    return this.call('uploadDocument', {
      name: a.name,
      hash: a.hash,
      pdfBlobIdStr: a.pdf_blob_id_str,
      fileSize: String(a.file_size),
      embeddings: a.embeddings,
      extractedText: a.extracted_text,
      chunks: a.chunks ? a.chunks.map(toWireChunk) : null,
    });
  }
  deleteDocument(a: { document_id: string }): Promise<void> {
    return this.call('deleteDocument', { documentId: a.document_id });
  }
  async listDocuments(): Promise<DocumentInfo[]> {
    return ((await this.view<WireDocumentInfo[]>('listDocuments')) ?? []).map(toDocumentInfo);
  }
  setConsent(a: { document_id: string }): Promise<void> {
    return this.call('setConsent', { documentId: a.document_id });
  }
  hasConsented(a: { user_id_str: string; document_id: string }): Promise<boolean> {
    return this.view('hasConsented', { userIdStr: a.user_id_str, documentId: a.document_id });
  }
  signDocument(a: {
    document_id: string;
    base_hash: string;
    pdf_blob_id_str: string;
    file_size: number;
    new_hash: string;
  }): Promise<void> {
    return this.call('signDocument', {
      documentId: a.document_id,
      baseHash: a.base_hash,
      pdfBlobIdStr: a.pdf_blob_id_str,
      fileSize: String(a.file_size),
      newHash: a.new_hash,
    });
  }
  async getDocumentSignatures(a: { document_id: string }): Promise<DocumentSignature[]> {
    const rows = await this.view<{ signer: string; signedAt: string }[]>('getDocumentSignatures', {
      documentId: a.document_id,
    });
    return (rows ?? []).map((r) => ({ signer: r.signer, signed_at: num(r.signedAt) }));
  }
  markParticipantSigned(a: { document_id: string }): Promise<void> {
    return this.call('markParticipantSigned', { documentId: a.document_id });
  }
  searchDocumentByEmbedding(a: { query_embedding: number[]; document_id: string }): Promise<string> {
    return this.view('searchDocumentByEmbedding', {
      queryEmbedding: a.query_embedding,
      documentId: a.document_id,
    });
  }
}
