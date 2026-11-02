// ── The one adapter between the component contract and the screens ─────────
//
// The screens were written against v1's generated client: snake_case fields,
// numbers for counts and times, `{ data, error }` envelopes, an agreement named
// by its context id and the private context found by itself. This class keeps
// exactly that surface and speaks the component contract underneath
// (`lib/meroSign.ts`): camelCase methods, u64 as decimal strings, paged lists
// (followed here, page by page), the personal library as its own app instance
// (`ensureLibrary`), and the signing call's passkey confirmation.
//
// Times: v1 answered nanoseconds; the component runtime answers milliseconds,
// and so does everything this adapter hands out.

import { describeError } from '@calimero-apps/connect';

import { ensureLibrary } from '../../lib/agreements';
import { contractAt, getConn, type Conn } from '../../lib/conn';
import {
  allPages,
  type Level,
  type WireChunk,
  type WireDetails,
  type WireDocument,
  type WireJoined,
  type WireSignature,
} from '../../lib/meroSign';
import {
  DocumentStatus,
  PermissionLevel,
  type ApiResponse,
  type ContextDetails,
  type ContextMetadata,
  type DocumentChunk,
  type DocumentInfo,
  type ErrorResponse,
  type SignatureRecord,
  type UserId,
} from '../clientApi';

const num = (v: string | number | null | undefined): number => Number(v ?? 0);

export function toSignatureRecord(s: WireSignature): SignatureRecord {
  return {
    id: num(s.id),
    name: s.name,
    blob_id: s.blobId,
    size: num(s.size),
    created_at: num(s.createdAt),
  };
}

export function toContextMetadata(c: WireJoined, account: string): ContextMetadata {
  return {
    context_id: c.contextId,
    context_name: c.contextName,
    role: c.role,
    joined_at: num(c.joinedAt),
    // One account is the same identity in every app: v1's per-context
    // identities collapse into it.
    private_identity: account,
    shared_identity: account,
  };
}

export function toContextDetails(d: WireDetails): ContextDetails {
  return {
    context_id: d.contextId,
    context_name: d.contextName,
    owner: d.owner,
    is_private: d.isPrivate,
    participant_count: num(d.participantCount),
    participants: d.participants.map((p) => ({
      user_id: p.userId,
      permission_level: p.permissionLevel as PermissionLevel,
    })),
    document_count: num(d.documentCount),
    created_at: num(d.createdAt),
  };
}

export function toDocumentInfo(d: WireDocument): DocumentInfo {
  return {
    id: d.id,
    name: d.name,
    hash: d.hash,
    uploaded_by: d.uploadedBy,
    uploaded_at: num(d.uploadedAt),
    status: d.status as DocumentStatus,
    pdf_blob_id: d.pdfBlobId,
    size: num(d.size),
  };
}

export function toWireChunk(c: DocumentChunk): WireChunk {
  return {
    text: c.text,
    embedding: c.embedding,
    startPosition: c.start_position,
    endPosition: c.end_position,
  };
}

type Result<T> = { data: T; error: null } | { data: null; error: ErrorResponse };

/** The contract's `{ code, fields: { message } }`, or the client's own description. */
export function errorOf(e: unknown): ErrorResponse {
  const fields = (e as { fields?: { message?: unknown } } | null)?.fields;
  const code = (e as { appCode?: unknown; status?: unknown } | null)?.appCode;
  const message =
    fields && typeof fields.message === 'string' && fields.message
      ? fields.message
      : describeError(e);
  return { code: typeof code === 'string' ? code : undefined, message };
}

async function run<T>(f: () => Promise<T>): Promise<Result<T>> {
  try {
    return { data: await f(), error: null };
  } catch (e) {
    return { data: null, error: errorOf(e) };
  }
}

const NO_SESSION: Result<never> = {
  data: null,
  error: { code: 401, message: 'Sign in first: there is no session.' },
};
const NO_AGREEMENT: Result<never> = {
  data: null,
  error: { message: 'No agreement is open.' },
};

/**
 * The contract for the screens. Agreement methods take the agreement's app id
 * (`agreementContextID`, as in v1); the `agreementContextUserID` v1 threaded
 * through is accepted and ignored. Library methods find (or make) the
 * account's personal library themselves.
 */
export class ClientApiDataSource {
  /** `conn` defaults to the signed-in session of `CalimeroProvider`. */
  constructor(private readonly given?: Conn | null) {}

  private get conn(): Conn | null {
    return this.given ?? getConn();
  }

  private agreement<T>(
    app: string | undefined,
    f: (c: ReturnType<typeof contractAt>, conn: Conn) => Promise<T>,
  ): ApiResponse<T> {
    const conn = this.conn;
    if (!conn) return Promise.resolve(NO_SESSION);
    const id = (app ?? '').trim();
    if (!id) return Promise.resolve(NO_AGREEMENT);
    return run(() => f(contractAt(conn, id), conn));
  }

  private library<T>(f: (c: ReturnType<typeof contractAt>, conn: Conn) => Promise<T>): ApiResponse<T> {
    const conn = this.conn;
    if (!conn) return Promise.resolve(NO_SESSION);
    return run(async () => f(contractAt(conn, await ensureLibrary(conn)), conn));
  }

  // ── the agreement ────────────────────────────────────────────────────────

  setConsent(documentId: string, agreementContextID?: string, _user?: string): ApiResponse<void> {
    return this.agreement(agreementContextID, async (c) => {
      await c.setConsent(documentId);
    });
  }

  hasConsented(
    userIdStr: UserId,
    documentId: string,
    agreementContextID?: string,
    _user?: string,
  ): ApiResponse<boolean> {
    return this.agreement(agreementContextID, (c) => c.hasConsented(userIdStr, documentId));
  }

  addParticipant(
    contextId: string,
    userIdStr: UserId,
    permission: PermissionLevel,
    agreementContextID?: string,
    _user?: string,
  ): ApiResponse<void> {
    return this.agreement(agreementContextID || contextId, async (c) => {
      await c.addParticipant(userIdStr, permission as Level);
    });
  }

  setParticipantPermission(
    userIdStr: UserId,
    permission: PermissionLevel,
    agreementContextID?: string,
    _user?: string,
  ): ApiResponse<void> {
    return this.agreement(agreementContextID, async (c) => {
      await c.setParticipantPermission(userIdStr, permission as Level);
    });
  }

  removeParticipant(userIdStr: UserId, agreementContextID?: string, _user?: string): ApiResponse<void> {
    return this.agreement(agreementContextID, async (c) => {
      await c.removeParticipant(userIdStr);
    });
  }

  registerSelfAsParticipant(agreementContextID?: string, _user?: string): ApiResponse<void> {
    return this.agreement(agreementContextID, async (c) => {
      await c.registerSelfAsParticipant();
    });
  }

  whoami(_agreementContextID?: string, _user?: string): ApiResponse<UserId> {
    const conn = this.conn;
    if (!conn) return Promise.resolve(NO_SESSION);
    // The session already knows; the contract would answer the same account.
    return Promise.resolve({ data: conn.accountId, error: null });
  }

  getContextDetails(
    contextId: string,
    agreementContextID?: string,
    _user?: string,
  ): ApiResponse<ContextDetails> {
    return this.agreement(agreementContextID || contextId, async (c) =>
      toContextDetails(await c.getContextDetails()),
    );
  }

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
    _user?: string,
  ): ApiResponse<string> {
    return this.agreement(agreementContextID || contextId, (c) =>
      c.uploadDocument({
        name,
        hash,
        pdfBlobIdStr,
        fileSize: String(fileSize),
        embeddings: embeddings ?? undefined,
        extractedText: extractedText ?? undefined,
        chunks: chunks ? chunks.map(toWireChunk) : undefined,
      }),
    );
  }

  deleteDocument(documentId: string, agreementContextID?: string, _user?: string): ApiResponse<void> {
    return this.agreement(agreementContextID, async (c) => {
      await c.deleteDocument(documentId);
    });
  }

  /** Every document, following the contract's pages. */
  listDocuments(contextId: string, agreementContextID?: string, _user?: string): ApiResponse<DocumentInfo[]> {
    return this.agreement(agreementContextID || contextId, async (c) =>
      (await allPages((cursor) => c.listDocuments(cursor, 1000))).map(toDocumentInfo),
    );
  }

  /** The caller's signature; the node asks for their passkey first. */
  signDocument(
    contextId: string,
    documentId: string,
    baseHash: string,
    pdfBlobIdStr: string,
    fileSize: number,
    newHash: string,
    agreementContextID?: string,
    _user?: string,
  ): ApiResponse<void> {
    return this.agreement(agreementContextID || contextId, async (c) => {
      await c.signDocument({
        documentId,
        baseHash,
        pdfBlobIdStr,
        fileSize: String(fileSize),
        newHash,
      });
    });
  }

  markParticipantSigned(
    contextId: string,
    documentId: string,
    agreementContextID?: string,
    _user?: string,
  ): ApiResponse<void> {
    return this.agreement(agreementContextID || contextId, async (c) => {
      await c.markParticipantSigned(documentId);
    });
  }

  searchDocumentByEmbedding(
    queryEmbedding: number[],
    documentId: string,
    agreementContextID?: string,
    _user?: string,
  ): ApiResponse<string> {
    return this.agreement(agreementContextID, (c) =>
      c.searchDocumentByEmbedding(queryEmbedding, documentId),
    );
  }

  // ── the personal library ─────────────────────────────────────────────────

  isDefaultPrivateContext(): ApiResponse<boolean> {
    return this.library((c) => c.isDefaultPrivateContext());
  }

  joinSharedContext(contextId: string, _sharedIdentityStr: UserId, name: string): ApiResponse<void> {
    return this.library(async (c) => {
      await c.joinSharedContext(contextId, name);
    });
  }

  listJoinedContexts(): ApiResponse<ContextMetadata[]> {
    return this.library(async (c, conn) =>
      (await allPages((cursor) => c.listJoinedContexts(cursor, 1000))).map((j) =>
        toContextMetadata(j, conn.accountId),
      ),
    );
  }

  leaveSharedContext(contextId: string): ApiResponse<void> {
    return this.library(async (c) => {
      await c.leaveSharedContext(contextId);
    });
  }

  createSignature(name: string, blobIdStr: string, dataSize: number): ApiResponse<number> {
    return this.library(async (c) => num(await c.createSignature(name, blobIdStr, String(dataSize))));
  }

  deleteSignature(signatureId: number): ApiResponse<void> {
    return this.library(async (c) => {
      await c.deleteSignature(String(signatureId));
    });
  }

  /** Every saved signature, following the contract's pages. */
  listSignatures(): ApiResponse<SignatureRecord[]> {
    return this.library(async (c) =>
      (await allPages((cursor) => c.listSignatures(cursor, 1000))).map(toSignatureRecord),
    );
  }

  // ── blobs ────────────────────────────────────────────────────────────────

  /** Upload bytes as a blob of `app` (an agreement, or the library when omitted); answers the hex id. */
  uploadBlob(data: Uint8Array, app?: string): ApiResponse<{ id: string; size: number }> {
    const conn = this.conn;
    if (!conn) return Promise.resolve(NO_SESSION);
    return run(async () => {
      const target = app || (await ensureLibrary(conn));
      const r = await conn.client.uploadBlob(target, data);
      conn.after();
      return { id: r.id, size: r.size };
    });
  }

  /** A blob's bytes, from `app` (an agreement, or the library when omitted). */
  downloadBlob(id: string, app?: string): ApiResponse<Uint8Array> {
    const conn = this.conn;
    if (!conn) return Promise.resolve(NO_SESSION);
    return run(async () => {
      const target = app || (await ensureLibrary(conn));
      const bytes = await conn.client.downloadBlob(target, id);
      conn.after();
      return bytes;
    });
  }
}
