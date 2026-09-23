// ── Every contract call, through the generated client ───────────────────────
//
// ⚠️ WHAT THIS REPLACES, AND THE FOUR BUGS THAT WERE HIDING IN IT.
//
// This file used to reach the contract through `rpcClient` — a compatibility
// shim in `lib/node.ts` that accepted the old SDK's shape and translated it to
// mero-js. Around every call sat the same forty lines: resolve an auth bundle,
// name the method with a `ClientMethod` string, spell the arguments by hand,
// unwrap `response.result?.output ?? response.result`, and map an error. Four
// real defects lived in that repetition, and none of them could be seen by
// reading the call site:
//
//   1. `leave_shared_context` was sent `{context_id}`. The ABI says
//      `context_id_str`. Every core request body is `deny_unknown_fields`, so
//      leaving a shared agreement answered 400 and had NEVER worked. (Its only
//      caller is commented out, which is why nobody noticed.)
//
//   2. `get_context_details` and `list_joined_contexts` ran their ids through
//      `bs58.encode`. Core 0.11.0-rc.27 removed base58 from the wire — ids are
//      hex. So every context id these two returned was in an encoding the
//      contract rejects.
//
//   3. `upload_document` passed `embeddings`, `extracted_text` and `chunks` as
//      `undefined` when the caller omitted them. `JSON.stringify` DROPS an
//      undefined value, so the contract saw three missing fields rather than
//      three nulls.
//
//   4. `deleteDocument`'s implementation took `(documentId, …)` while the
//      `ClientApi` interface declared `(contextId, documentId, …)`. Both are
//      strings, so the disagreement type-checked; the one existing caller
//      happens to follow the implementation. Anyone writing a second caller
//      from the interface would have passed a document id as a context id.
//
// None of the four is expressible now. `MeroSignClient` is generated from
// `logic/res/abi.json` by `@calimero-network/abi-codegen`, so the method names,
// the argument names and the return types come from the contract itself: a
// misspelled argument is a type error rather than a 400, and a contract change
// this app has not followed fails the build rather than the user's click. It is
// the same arrangement every other app in this repo already has — mero-pass's
// `generated/MeroPassClient` behind `lib/vault.ts`, mero-forum's `ForumClient`
// behind `lib/groups.ts`.
//
// ⚠️ `pnpm codegen` regenerates the client. Do not edit `generated/`.
//
// ── The two things this file still owes the rest of the app ─────────────────
//
// WHICH CONTEXT a call runs in, and TRANSLATION at the boundary. The generated
// client is per-context (the id goes in its constructor), and it returns the
// ABI's own types, where an id is a `CalimeroBytes` rather than a string. The
// app's own types — `clientApi.ts` — use hex strings, which is what the UI
// renders and what the contract's `parse_public_key_hex` takes back. Both jobs
// are done once each, below, instead of once per method.

import { getContextId } from '../../lib/node';
import type { ApiResponse, ErrorResponse } from '../../lib/node';
import {
  ClientApi,
  ContextDetails,
  ContextMetadata,
  DocumentInfo,
  DocumentStatus,
  PermissionLevel,
  UserId,
} from '../clientApi';
import { DefaultContextService } from '../defaultContextService';
import { toHexId } from '../../lib/participants';
import { toBlobIdHex } from '../../lib/blobIds';
import { clientFor } from '../../lib/signClient';
import { CalimeroBytes } from '../../generated/MeroSignClient';
import type {
  ContextDetails as AbiContextDetails,
  ContextMetadata as AbiContextMetadata,
  DocumentChunk as AbiDocumentChunk,
  DocumentInfo as AbiDocumentInfo,
  MeroSignClient,
  SignatureRecord,
} from '../../generated/MeroSignClient';

/**
 * The node's own words for a failure, whatever shape it arrived in.
 *
 * ⚠️ NOT `instanceof Error`. A rejected RPC arrives as a plain object or a
 * string as often as an `Error`, and an `instanceof` test turns those into a
 * generic sentence — losing exactly the reason this function exists. Core's
 * "Uninitialized" is translated because it means "retry", not "failed".
 */
function getErrorMessage(error: any): string {
  if (
    error?.type === 'Uninitialized' ||
    error?.message?.includes('Uninitialized')
  ) {
    return 'Syncing state, Please wait and retry.';
  }
  if (
    error?.error?.name === 'UnknownServerError' &&
    error?.error?.cause?.info?.message?.includes(
      'Verify that the node server is running',
    )
  ) {
    return 'Syncing state, Please wait and retry.';
  }
  if (typeof error === 'string') return error;
  if (error?.message) return error.message;
  if (error?.data) return JSON.stringify(error.data);
  return 'An unexpected error occurred';
}

// ── Translation at the boundary ─────────────────────────────────────────────

type Bytes = CalimeroBytes | string | number[] | Uint8Array;

/**
 * An id as hex — the only encoding the contract's parsers accept since rc.27.
 *
 * ⚠️ This is where `bs58.encode` used to be. `CalimeroBytes` wraps the byte
 * array the wire actually carries; `toHexId` is the app's single spelling of
 * "32 bytes, lowercase hex".
 */
function hexOf(value: Bytes): string {
  return toHexId(value instanceof CalimeroBytes ? value.toUint8Array() : value);
}

/** A blob id as hex, tolerating ids a previous build wrote as base58. */
function blobHexOf(value: Bytes): string {
  return toBlobIdHex(
    value instanceof CalimeroBytes ? value.toUint8Array() : value,
  );
}

function toContextDetails(d: AbiContextDetails): ContextDetails {
  return {
    context_id: hexOf(d.context_id),
    context_name: d.context_name,
    owner: hexOf(d.owner),
    is_private: d.is_private,
    participant_count: d.participant_count,
    participants: (d.participants ?? []).map((p) => ({
      user_id: hexOf(p.user_id),
      // The ABI types this as a string union and the app as an enum with the
      // same members. Assignment the other way is checked; this direction
      // needs the cast because TypeScript treats a string enum as nominal.
      permission_level: p.permission_level as PermissionLevel,
    })),
    document_count: d.document_count,
    created_at: d.created_at,
  };
}

function toDocumentInfo(d: AbiDocumentInfo): DocumentInfo {
  return {
    id: d.id,
    name: d.name,
    hash: d.hash,
    uploaded_by: hexOf(d.uploaded_by),
    uploaded_at: d.uploaded_at,
    status: d.status as DocumentStatus,
    pdf_blob_id: blobHexOf(d.pdf_blob_id),
    size: d.size,
    // `null` is the contract's absence; the app's type says optional.
    embeddings: d.embeddings ?? undefined,
    extracted_text: d.extracted_text ?? undefined,
  };
}

function toContextMetadata(c: AbiContextMetadata): ContextMetadata {
  return {
    context_id: hexOf(c.context_id),
    context_name: c.context_name,
    role: c.role,
    joined_at: c.joined_at,
    private_identity: hexOf(c.private_identity),
    shared_identity: hexOf(c.shared_identity),
  };
}

// ── Envelopes ───────────────────────────────────────────────────────────────

function ok<T>(data: T): { data: T; error: null } {
  return { data, error: null };
}

function failed(
  what: string,
  error: unknown,
): { data: null; error: ErrorResponse } {
  const message = getErrorMessage(error);
  return {
    data: null,
    error: {
      code: 500,
      message:
        message && message !== 'An unexpected error occurred'
          ? message
          : `Could not ${what}.`,
    },
  };
}

/**
 * No context to call in.
 *
 * Its own answer rather than a 500, because it is an ordinary state — a node
 * that has just connected, or an agreement the user has not opened yet — and
 * the caller can say so in words instead of reporting a failure.
 */
function noContext(): { data: null; error: ErrorResponse } {
  return {
    data: null,
    error: {
      code: 409,
      message:
        'No agreement is open on this node yet. Give it a moment and try ' +
        'again.',
    },
  };
}

function noPrivateContext(): { data: null; error: ErrorResponse } {
  return {
    data: null,
    error: {
      code: 409,
      message:
        'Your private signature store is not ready on this node yet. Give it ' +
        'a moment and try again.',
    },
  };
}

/**
 * This node's private context, which is where signatures and the local
 * registry of joined agreements live.
 */
function storedPrivateContextId(): string {
  try {
    return localStorage.getItem('defaultContextId') ?? '';
  } catch {
    return '';
  }
}

export class ClientApiDataSource implements ClientApi {
  private app: any;

  constructor(app?: any) {
    this.app = app;
  }

  // ── Which context a call runs in ──────────────────────────────────────────
  //
  // ⚠️ `agreementContextUserID` is accepted by almost every method below and
  // used by none of them. It holds the context member (DEVICE) key, which core
  // removed from the JSON-RPC body in #2116 — the node resolves the caller's
  // own identity now (#3960), and sending the field is a 400 for the whole
  // call because every body is `deny_unknown_fields`. The parameters stay so
  // the call sites are untouched by this change; `lib/node.ts` still stores
  // the key, which other files legitimately read for their own purposes.

  /** The shared agreement context a call should run in. */
  private shared(agreementContextID?: string, explicit?: string): string {
    return (agreementContextID || explicit || getContextId() || '').trim();
  }

  /**
   * The private context, creating it if this node has not got one yet.
   *
   * The creation path matters: `listJoinedContexts` is often the first call a
   * freshly connected node makes, and returning "no context" there would show
   * an empty agreement list on a node that simply had not bootstrapped.
   */
  private async privateContext(): Promise<string> {
    const stored = storedPrivateContextId();
    if (stored) return stored;
    if (!this.app) return '';
    const service = DefaultContextService.getInstance(this.app);
    const kept = service.getStoredDefaultContext();
    if (kept?.contextId) return kept.contextId;
    const ensured = await service.ensureDefaultContext();
    return ensured.success && ensured.contextInfo
      ? ensured.contextInfo.contextId
      : '';
  }

  /**
   * Run one typed call and shape the answer.
   *
   * The generated client THROWS on failure rather than returning an envelope,
   * which is the property this whole change rests on: there is no shape in
   * which a refused call looks like a successful one, so nothing here can
   * quietly continue past an error the way the old catch-and-fall-back did.
   */
  private async run<T>(
    what: string,
    contextId: string,
    call: (client: MeroSignClient) => Promise<T>,
  ): Promise<{ data: T; error: null } | { data: null; error: ErrorResponse }> {
    if (!contextId) return noContext();
    try {
      return ok(await call(clientFor(contextId)));
    } catch (error) {
      return failed(what, error);
    }
  }

  /** As `run`, but in the private context, with its own way of being absent. */
  private async runPrivate<T>(
    what: string,
    call: (client: MeroSignClient) => Promise<T>,
  ): Promise<{ data: T; error: null } | { data: null; error: ErrorResponse }> {
    const contextId = await this.privateContext();
    if (!contextId) return noPrivateContext();
    try {
      return ok(await call(clientFor(contextId)));
    } catch (error) {
      return failed(what, error);
    }
  }

  // ── Consent ───────────────────────────────────────────────────────────────

  /**
   * Record MY consent to sign a document.
   *
   * ⚠️ There is no `userId` parameter. The contract used to take one and store
   * consent against it with no gate at all, and consent was the only
   * precondition `sign_document` checked — so the two together let one member
   * manufacture both halves of somebody else's signature. The contract derives
   * the consenter from `env::account_id()`.
   */
  async setConsent(
    documentId: string,
    agreementContextID?: string,
    _agreementContextUserID?: string,
  ): ApiResponse<void> {
    return this.run(
      'record your consent',
      this.shared(agreementContextID),
      (c) => c.setConsent({ document_id: documentId }),
    );
  }

  /**
   * Has this ACCOUNT consented to sign this document?
   *
   * ⚠️ `userIdStr` is an ACCOUNT id. Consent is stored against
   * `env::account_id()`, while this app also holds a context member (DEVICE)
   * key — and since rc.27 both are 64 hex characters, so passing the wrong one
   * type-checks and silently matches nothing. Get yours from `whoami()`.
   */
  async hasConsented(
    userIdStr: UserId,
    documentId: string,
    agreementContextID?: string,
    _agreementContextUserID?: string,
  ): ApiResponse<boolean> {
    return this.run(
      'check whether you have consented',
      this.shared(agreementContextID),
      (c) =>
        c.hasConsented({ user_id_str: userIdStr, document_id: documentId }),
    );
  }

  // ── Participants ──────────────────────────────────────────────────────────

  async addParticipant(
    contextId: string,
    userIdStr: UserId,
    permission: PermissionLevel,
    agreementContextID?: string,
    _agreementContextUserID?: string,
  ): ApiResponse<void> {
    return this.run(
      'add that participant',
      this.shared(agreementContextID, contextId),
      (c) => c.addParticipant({ user_id_str: userIdStr, permission }),
    );
  }

  /**
   * Change an EXISTING participant's permission level.
   *
   * ⚠️ Raising only. The contract refuses a demotion because permissions merge
   * by taking the higher rank, so a lowered level would apply on the admin's
   * node and be discarded everywhere else. The refusal comes back as the
   * contract's own message; see `lib/participants.ts`.
   */
  async setParticipantPermission(
    userIdStr: UserId,
    permission: PermissionLevel,
    agreementContextID?: string,
    _agreementContextUserID?: string,
  ): ApiResponse<void> {
    return this.run(
      'change that permission',
      this.shared(agreementContextID),
      (c) => c.setParticipantPermission({ user_id_str: userIdStr, permission }),
    );
  }

  /** Remove a participant, taking their permission with them. */
  async removeParticipant(
    userIdStr: UserId,
    agreementContextID?: string,
    _agreementContextUserID?: string,
  ): ApiResponse<void> {
    return this.run(
      'remove that participant',
      this.shared(agreementContextID),
      (c) => c.removeParticipant({ user_id_str: userIdStr }),
    );
  }

  /** Register myself as a participant — the path a joiner takes. */
  async registerSelfAsParticipant(
    agreementContextID: string,
    _agreementContextUserID?: string,
  ): ApiResponse<void> {
    return this.run(
      'register you in this agreement',
      this.shared(agreementContextID),
      (c) => c.registerSelfAsParticipant(),
    );
  }

  /**
   * The caller's ACCOUNT id, straight from the contract.
   *
   * The app cannot work this out for itself: it holds
   * `localStorage['agreementContextUserID']`, which is the context member
   * (DEVICE) key from the join response, while every permission is keyed by
   * account — and since rc.27 both are 64 hex characters, so comparing the
   * wrong pair type-checks and silently matches nothing. Asking the contract
   * is the only way to know which row of the roster is you.
   */
  async whoami(
    agreementContextID?: string,
    _agreementContextUserID?: string,
  ): ApiResponse<UserId> {
    const res = await this.run(
      'identify you in this agreement',
      this.shared(agreementContextID),
      (c) => c.whoami(),
    );
    if (res.error) return { data: null, error: res.error };
    return ok(hexOf(res.data));
  }

  // ── Contexts ──────────────────────────────────────────────────────────────

  async isDefaultPrivateContext(): ApiResponse<boolean> {
    return this.runPrivate('check your private context', (c) =>
      c.isDefaultPrivateContext(),
    );
  }

  /**
   * An agreement's name, owner and roster.
   *
   * ⚠️ `contextId` is the SUBJECT of the question and `agreementContextID` is
   * where the question is asked — they are usually the same context, and the
   * call is not wrong when they differ.
   */
  async getContextDetails(
    contextId: string,
    agreementContextID?: string,
    _agreementContextUserID?: string,
  ): ApiResponse<ContextDetails> {
    const res = await this.run(
      'read this agreement',
      this.shared(agreementContextID, contextId),
      (c) => c.getContextDetails({ context_id_str: contextId }),
    );
    if (res.error) return { data: null, error: res.error };
    return ok(toContextDetails(res.data));
  }

  /** Record a shared agreement in this node's private registry. */
  async joinSharedContext(
    contextId: string,
    sharedIdentityStr: UserId,
    name: string,
  ): ApiResponse<void> {
    if (!sharedIdentityStr) {
      return {
        data: null,
        error: {
          code: 400,
          message:
            'This agreement cannot be recorded without the identity it was ' +
            'joined with.',
        },
      };
    }
    return this.runPrivate('record this agreement', (c) =>
      c.joinSharedContext({
        context_id_str: contextId,
        shared_identity_str: sharedIdentityStr,
        context_name: name,
      }),
    );
  }

  async listJoinedContexts(): ApiResponse<ContextMetadata[]> {
    const res = await this.runPrivate('list your agreements', (c) =>
      c.listJoinedContexts(),
    );
    if (res.error) return { data: null, error: res.error };
    return ok((res.data ?? []).map(toContextMetadata));
  }

  /**
   * ⚠️ The argument is `context_id_str`. It was `context_id` here, which no
   * version of this contract has ever accepted — so leaving a shared agreement
   * answered 400 every time it was called. It has one caller and that caller
   * is commented out, which is the only reason it went unreported.
   */
  async leaveSharedContext(contextId: string): ApiResponse<void> {
    return this.runPrivate('leave that agreement', (c) =>
      c.leaveSharedContext({ context_id_str: contextId }),
    );
  }

  // ── Documents ─────────────────────────────────────────────────────────────

  /**
   * ⚠️ The three optional arguments are sent as `null`, never `undefined`.
   * `JSON.stringify` DROPS an undefined value, so passing one through made the
   * contract see a missing field rather than an absent value.
   */
  async uploadDocument(
    contextId: string,
    name: string,
    hash: string,
    pdfBlobIdStr: string,
    fileSize: number,
    embeddings?: number[],
    extractedText?: string,
    chunks?: AbiDocumentChunk[],
    agreementContextID?: string,
    _agreementContextUserID?: string,
  ): ApiResponse<string> {
    return this.run(
      'upload that document',
      this.shared(agreementContextID, contextId),
      (c) =>
        c.uploadDocument({
          name,
          hash,
          pdf_blob_id_str: pdfBlobIdStr,
          file_size: fileSize,
          embeddings: embeddings ?? null,
          extracted_text: extractedText ?? null,
          chunks: chunks ?? null,
        }),
    );
  }

  /**
   * ⚠️ `documentId` FIRST. The `ClientApi` interface used to declare
   * `(contextId, documentId, …)` while this took `(documentId, …)`. Both are
   * strings, so the disagreement type-checked and the single existing caller
   * happened to follow the implementation. The interface now says what the
   * code does.
   */
  async deleteDocument(
    documentId: string,
    agreementContextID?: string,
    _agreementContextUserID?: string,
  ): ApiResponse<void> {
    return this.run(
      'delete that document',
      this.shared(agreementContextID),
      (c) => c.deleteDocument({ document_id: documentId }),
    );
  }

  async listDocuments(
    contextId: string,
    agreementContextID?: string,
    _agreementContextUserID?: string,
  ): ApiResponse<DocumentInfo[]> {
    const res = await this.run(
      'list the documents',
      this.shared(agreementContextID, contextId),
      (c) => c.listDocuments(),
    );
    if (res.error) return { data: null, error: res.error };
    return ok((res.data ?? []).map(toDocumentInfo));
  }

  /**
   * Sign a document AS MYSELF.
   *
   * ⚠️ There is no `signerId` parameter, and its absence is the point. The
   * contract used to take `signer_id_str` and write it straight into
   * `DocumentSignature.signer` with no check against the caller, so any member
   * could record a signature attributed to another member. This app handed it
   * the context member DEVICE key, while the contract keys participants and
   * permissions by ACCOUNT, so the recorded signer matched nobody in the
   * roster and no document could ever reach `FullySigned` either.
   *
   * The contract derives the signer from `env::account_id()`. Nothing here can
   * name a signer, so nothing here can name the wrong one.
   */
  async signDocument(
    contextId: string,
    documentId: string,
    baseHash: string,
    pdfBlobIdStr: string,
    fileSize: number,
    newHash: string,
    agreementContextID?: string,
    _agreementContextUserID?: string,
  ): ApiResponse<void> {
    return this.run(
      'sign that document',
      this.shared(agreementContextID, contextId),
      (c) =>
        c.signDocument({
          document_id: documentId,
          base_hash: baseHash,
          pdf_blob_id_str: pdfBlobIdStr,
          file_size: fileSize,
          new_hash: newHash,
        }),
    );
  }

  /**
   * Recompute a document's status after I have signed it.
   *
   * Note the effect this unlocks: the contract compares recorded signers
   * against `participants`, which holds ACCOUNTS, while signatures used to
   * hold the DEVICE key this app passed — so no document could ever reach
   * `FullySigned`.
   */
  async markParticipantSigned(
    contextId: string,
    documentId: string,
    agreementContextID?: string,
    _agreementContextUserID?: string,
  ): ApiResponse<void> {
    return this.run(
      'update that document’s status',
      this.shared(agreementContextID, contextId),
      (c) => c.markParticipantSigned({ document_id: documentId }),
    );
  }

  async searchDocumentByEmbedding(
    queryEmbedding: number[],
    documentId: string,
    agreementContextID?: string,
    _agreementContextUserID?: string,
  ): ApiResponse<string> {
    return this.run(
      'search that document',
      this.shared(agreementContextID),
      (c) =>
        c.searchDocumentByEmbedding({
          query_embedding: queryEmbedding,
          document_id: documentId,
        }),
    );
  }

  // ── Signatures, in the private context ────────────────────────────────────

  /**
   * ⚠️ What was here read the stored default context and passed the whole
   * RECORD to `execute` where a context ID belongs, then caught the node's
   * `ParseError: invalid type: map, expected a hex encoded hash` into a
   * `console.warn` before trying a second path. The signature's blob uploaded,
   * the contract call was refused, and the row never existed — which read as
   * "it saves but is not displayed".
   */
  async createSignature(
    name: string,
    blobIdStr: string,
    dataSize: number,
  ): ApiResponse<number> {
    return this.runPrivate('create the signature', (c) =>
      c.createSignature({
        name,
        blob_id_str: blobIdStr,
        data_size: dataSize,
      }),
    );
  }

  async deleteSignature(signatureId: number): ApiResponse<void> {
    return this.runPrivate('delete that signature', (c) =>
      c.deleteSignature({ signature_id: signatureId }),
    );
  }

  async listSignatures(): ApiResponse<SignatureRecord[]> {
    return this.runPrivate('list your signatures', (c) => c.listSignatures());
  }
}
