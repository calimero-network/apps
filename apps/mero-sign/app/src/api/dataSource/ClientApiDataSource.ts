/**
 * The contract, in the `{ data, error }` shape the screens branch on.
 *
 * Every shared-agreement method runs on the agreement instance the caller
 * names (`agreementContextID`, else `contextId`, else the agreement this
 * browser has open). The signature-library methods run on the account's
 * private library (`defaultContextIdFor`). The calls themselves, and the
 * conversion of the contract's answers, are `lib/meroSign`.
 *
 * The trailing `agreementContextUserID` arguments are v1's member key. On
 * Calimero 1.0 the caller is the account on every instance, so they are
 * accepted and ignored.
 */
import { getContextId, meroSignApp, wrap, type ApiResponse, type ErrorResponse } from '../../lib/node';
import type { MeroSignApp } from '../../lib/meroSign';
import type {
  ClientApi,
  ContextDetails,
  ContextMetadata,
  DocumentChunk,
  DocumentInfo,
  PermissionLevel,
  SignatureRecord,
  UserId,
} from '../clientApi';
import { defaultContextIdFor } from '../defaultContextService';

function noContext(): { data: null; error: ErrorResponse } {
  return {
    data: null,
    error: {
      code: 409,
      message: 'No agreement is open. Open one from its workspace first.',
    },
  };
}

export class ClientApiDataSource implements ClientApi {
  // The signed-in session the screen holds; requests use `lib/node`'s.
  constructor(_app?: unknown) {}

  private shared(agreementContextID?: string, explicit?: string): string {
    return (agreementContextID || explicit || getContextId() || '').trim();
  }

  private async run<T>(
    contextId: string,
    call: (app: MeroSignApp) => Promise<T>,
  ): ApiResponse<T> {
    if (!contextId) return noContext();
    return wrap(() => call(meroSignApp(contextId)));
  }

  private async runPrivate<T>(
    call: (app: MeroSignApp) => Promise<T>,
  ): ApiResponse<T> {
    return wrap(async () => call(meroSignApp(await defaultContextIdFor())));
  }

  // ── consent, people ────────────────────────────────────────────────────────

  async setConsent(
    documentId: string,
    agreementContextID?: string,
    _agreementContextUserID?: string,
  ): ApiResponse<void> {
    return this.run(this.shared(agreementContextID), (c) =>
      c.setConsent({ document_id: documentId }),
    );
  }

  async hasConsented(
    userIdStr: UserId,
    documentId: string,
    agreementContextID?: string,
    _agreementContextUserID?: string,
  ): ApiResponse<boolean> {
    return this.run(this.shared(agreementContextID), (c) =>
      c.hasConsented({ user_id_str: userIdStr, document_id: documentId }),
    );
  }

  async addParticipant(
    contextId: string,
    userIdStr: UserId,
    permission: PermissionLevel,
    agreementContextID?: string,
    _agreementContextUserID?: string,
  ): ApiResponse<void> {
    return this.run(this.shared(agreementContextID, contextId), (c) =>
      c.addParticipant({ user_id_str: userIdStr, permission }),
    );
  }

  async setParticipantPermission(
    userIdStr: UserId,
    permission: PermissionLevel,
    agreementContextID?: string,
    _agreementContextUserID?: string,
  ): ApiResponse<void> {
    return this.run(this.shared(agreementContextID), (c) =>
      c.setParticipantPermission({ user_id_str: userIdStr, permission }),
    );
  }

  async removeParticipant(
    userIdStr: UserId,
    agreementContextID?: string,
    _agreementContextUserID?: string,
  ): ApiResponse<void> {
    return this.run(this.shared(agreementContextID), (c) =>
      c.removeParticipant({ user_id_str: userIdStr }),
    );
  }

  async registerSelfAsParticipant(
    agreementContextID: string,
    _agreementContextUserID?: string,
  ): ApiResponse<void> {
    return this.run(this.shared(agreementContextID), (c) =>
      c.registerSelfAsParticipant(),
    );
  }

  async whoami(
    agreementContextID?: string,
    _agreementContextUserID?: string,
  ): ApiResponse<UserId> {
    return this.run(this.shared(agreementContextID), (c) => c.whoami());
  }

  async isDefaultPrivateContext(): ApiResponse<boolean> {
    return this.runPrivate((c) => c.isDefaultPrivateContext());
  }

  async getContextDetails(
    contextId: string,
    agreementContextID?: string,
    _agreementContextUserID?: string,
  ): ApiResponse<ContextDetails> {
    return this.run(this.shared(agreementContextID, contextId), (c) =>
      c.getContextDetails({ context_id_str: contextId }),
    );
  }

  // ── the private library ────────────────────────────────────────────────────

  async joinSharedContext(
    contextId: string,
    sharedIdentityStr: UserId,
    name: string,
  ): ApiResponse<void> {
    return this.runPrivate((c) =>
      c.joinSharedContext({
        context_id_str: contextId,
        shared_identity_str: sharedIdentityStr,
        context_name: name,
      }),
    );
  }

  async listJoinedContexts(): ApiResponse<ContextMetadata[]> {
    return this.runPrivate((c) => c.listJoinedContexts());
  }

  async leaveSharedContext(contextId: string): ApiResponse<void> {
    return this.runPrivate((c) =>
      c.leaveSharedContext({ context_id_str: contextId }),
    );
  }

  async createSignature(
    name: string,
    blobIdStr: string,
    dataSize: number,
  ): ApiResponse<number> {
    return this.runPrivate((c) =>
      c.createSignature({ name, blob_id_str: blobIdStr, data_size: dataSize }),
    );
  }

  async deleteSignature(signatureId: number): ApiResponse<void> {
    return this.runPrivate((c) =>
      c.deleteSignature({ signature_id: signatureId }),
    );
  }

  async listSignatures(): ApiResponse<SignatureRecord[]> {
    return this.runPrivate((c) => c.listSignatures());
  }

  // ── documents ──────────────────────────────────────────────────────────────

  async uploadDocument(
    contextId: string,
    name: string,
    hash: string,
    pdfBlobIdStr: string,
    fileSize: number,
    embeddings?: number[],
    extractedText?: string,
    chunks?: DocumentChunk[],
    agreementContextID?: string,
    _agreementContextUserID?: string,
  ): ApiResponse<string> {
    return this.run(this.shared(agreementContextID, contextId), (c) =>
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

  async deleteDocument(
    documentId: string,
    agreementContextID?: string,
    _agreementContextUserID?: string,
  ): ApiResponse<void> {
    return this.run(this.shared(agreementContextID), (c) =>
      c.deleteDocument({ document_id: documentId }),
    );
  }

  async listDocuments(
    contextId: string,
    agreementContextID?: string,
    _agreementContextUserID?: string,
  ): ApiResponse<DocumentInfo[]> {
    return this.run(this.shared(agreementContextID, contextId), (c) =>
      c.listDocuments(),
    );
  }

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
    return this.run(this.shared(agreementContextID, contextId), (c) =>
      c.signDocument({
        document_id: documentId,
        base_hash: baseHash,
        pdf_blob_id_str: pdfBlobIdStr,
        file_size: fileSize,
        new_hash: newHash,
      }),
    );
  }

  async markParticipantSigned(
    contextId: string,
    documentId: string,
    agreementContextID?: string,
    _agreementContextUserID?: string,
  ): ApiResponse<void> {
    return this.run(this.shared(agreementContextID, contextId), (c) =>
      c.markParticipantSigned({ document_id: documentId }),
    );
  }

  async searchDocumentByEmbedding(
    queryEmbedding: number[],
    documentId: string,
    agreementContextID?: string,
    _agreementContextUserID?: string,
  ): ApiResponse<string> {
    return this.run(this.shared(agreementContextID), (c) =>
      c.searchDocumentByEmbedding({
        query_embedding: queryEmbedding,
        document_id: documentId,
      }),
    );
  }
}
