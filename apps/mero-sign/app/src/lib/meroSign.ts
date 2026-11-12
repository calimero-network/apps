/**
 * The contract is called through `MeroSignClient`, which `mero-app-build
 * codegen` writes from `logic/res/abi.json` (`src/generated/client.ts`). The
 * ABI names its records without their shapes, so the generated types are
 * `unknown`: this file turns each answer back into the snake_case,
 * number-valued shapes the screens have always used (`src/api/clientApi.ts`).
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
 * Calls go through the app's log, views to a node. The client's `after` runs
 * after every request: it keeps the stored session current (refresh tokens
 * are single-use).
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
import type { AppTransport } from '../generated/client';

/** What the generated client is built over: a signed-in `CalimeroClient` in the app. */
export type Transport = AppTransport;

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

export function toWireChunk(c: DocumentChunk) {
  return {
    text: c.text,
    embedding: c.embedding,
    startPosition: c.start_position,
    endPosition: c.end_position,
  };
}

// ── answers, in the screens' shapes ──────────────────────────────────────────

/** `listSignatures`'s answer. */
export const toSignatures = (v: unknown): SignatureRecord[] => ((v as WireSignature[] | null) ?? []).map(toSignature);
/** `listJoinedContexts`'s answer. */
export const toContexts = (v: unknown): ContextMetadata[] =>
  ((v as WireContextMetadata[] | null) ?? []).map(toContextMetadata);
/** `getIdentityMapping`'s answer. */
export const toMapping = (v: unknown): IdentityMapping => toIdentityMapping(v as WireIdentityMapping);
/** `getContextDetails`'s answer. */
export const toDetails = (v: unknown): ContextDetails => toContextDetails(v as WireContextDetails);
/** `listDocuments`'s answer. */
export const toDocuments = (v: unknown): DocumentInfo[] => ((v as WireDocumentInfo[] | null) ?? []).map(toDocumentInfo);
/** `getDocumentSignatures`'s answer. */
export const toDocumentSignatures = (v: unknown): DocumentSignature[] =>
  ((v as { signer: string; signedAt: string }[] | null) ?? []).map((r) => ({ signer: r.signer, signed_at: num(r.signedAt) }));
/** A u64 answer (`createSignature`'s id) as a number. */
export const toNumber = (v: unknown): number => num(v as string);
