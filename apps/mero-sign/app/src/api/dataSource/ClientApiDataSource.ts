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
import type { MeroSignClient } from '../../generated/client';
import {
  toContexts,
  toDetails,
  toDocuments,
  toNumber,
  toSignatures,
  toWireChunk,
} from '../../lib/meroSign';
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
    call: (app: MeroSignClient) => Promise<T>,
  ): ApiResponse<T> {
    if (!contextId) return noContext();
    return wrap(() => call(meroSignApp(contextId)));
  }

  private async runPrivate<T>(
    call: (app: MeroSignClient) => Promise<T>,
  ): ApiResponse<T> {
    return wrap(async () => call(meroSignApp(await defaultContextIdFor())));
  }

  // ── consent, people ────────────────────────────────────────────────────────

  async setConsent(
    documentId: string,
    agreementContextID?: string,
    _agreementContextUserID?: string,
  ): ApiResponse<void> {
    return this.run(this.shared(agreementContextID), async (c) => {
      await c.setConsent({ documentId });
    });
  }

  async hasConsented(
    userIdStr: UserId,
    documentId: string,
    agreementContextID?: string,
    _agreementContextUserID?: string,
  ): ApiResponse<boolean> {
    return this.run(this.shared(agreementContextID), (c) =>
      c.hasConsented({ userIdStr, documentId }),
    );
  }

  async addParticipant(
    contextId: string,
    userIdStr: UserId,
    permission: PermissionLevel,
    agreementContextID?: string,
    _agreementContextUserID?: string,
  ): ApiResponse<void> {
    return this.run(this.shared(agreementContextID, contextId), async (c) => {
      await c.addParticipant({ userIdStr, permission });
    });
  }

  async setParticipantPermission(
    userIdStr: UserId,
    permission: PermissionLevel,
    agreementContextID?: string,
    _agreementContextUserID?: string,
  ): ApiResponse<void> {
    return this.run(this.shared(agreementContextID), async (c) => {
      await c.setParticipantPermission({ userIdStr, permission });
    });
  }

  async removeParticipant(
    userIdStr: UserId,
    agreementContextID?: string,
    _agreementContextUserID?: string,
  ): ApiResponse<void> {
    return this.run(this.shared(agreementContextID), async (c) => {
      await c.removeParticipant({ userIdStr });
    });
  }

  async registerSelfAsParticipant(
    agreementContextID: string,
    _agreementContextUserID?: string,
  ): ApiResponse<void> {
    return this.run(this.shared(agreementContextID), async (c) => {
      await c.registerSelfAsParticipant();
    });
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
      c.getContextDetails({ contextIdStr: contextId }).then(toDetails),
    );
  }

  // ── the private library ────────────────────────────────────────────────────

  async joinSharedContext(
    contextId: string,
    sharedIdentityStr: UserId,
    name: string,
  ): ApiResponse<void> {
    return this.runPrivate(async (c) => {
      await c.joinSharedContext({
        contextIdStr: contextId,
        sharedIdentityStr,
        contextName: name,
      });
    });
  }

  async listJoinedContexts(): ApiResponse<ContextMetadata[]> {
    return this.runPrivate((c) => c.listJoinedContexts().then(toContexts));
  }

  async leaveSharedContext(contextId: string): ApiResponse<void> {
    return this.runPrivate(async (c) => {
      await c.leaveSharedContext({ contextIdStr: contextId });
    });
  }

  async createSignature(
    name: string,
    blobIdStr: string,
    dataSize: number,
  ): ApiResponse<number> {
    return this.runPrivate((c) =>
      c.createSignature({ name, blobIdStr, dataSize: String(dataSize) }).then(toNumber),
    );
  }

  async deleteSignature(signatureId: number): ApiResponse<void> {
    return this.runPrivate(async (c) => {
      await c.deleteSignature({ signatureId: String(signatureId) });
    });
  }

  async listSignatures(): ApiResponse<SignatureRecord[]> {
    return this.runPrivate((c) => c.listSignatures().then(toSignatures));
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
        pdfBlobIdStr,
        fileSize: String(fileSize),
        embeddings: embeddings ?? null,
        extractedText: extractedText ?? null,
        chunks: chunks ? chunks.map(toWireChunk) : null,
      }),
    );
  }

  async deleteDocument(
    documentId: string,
    agreementContextID?: string,
    _agreementContextUserID?: string,
  ): ApiResponse<void> {
    return this.run(this.shared(agreementContextID), async (c) => {
      await c.deleteDocument({ documentId });
    });
  }

  async listDocuments(
    contextId: string,
    agreementContextID?: string,
    _agreementContextUserID?: string,
  ): ApiResponse<DocumentInfo[]> {
    return this.run(this.shared(agreementContextID, contextId), (c) =>
      c.listDocuments().then(toDocuments),
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
    return this.run(this.shared(agreementContextID, contextId), async (c) => {
      await c.signDocument({
        documentId,
        baseHash,
        pdfBlobIdStr,
        fileSize: String(fileSize),
        newHash,
      });
    });
  }

  async markParticipantSigned(
    contextId: string,
    documentId: string,
    agreementContextID?: string,
    _agreementContextUserID?: string,
  ): ApiResponse<void> {
    return this.run(this.shared(agreementContextID, contextId), async (c) => {
      await c.markParticipantSigned({ documentId });
    });
  }

  async searchDocumentByEmbedding(
    queryEmbedding: number[],
    documentId: string,
    agreementContextID?: string,
    _agreementContextUserID?: string,
  ): ApiResponse<string> {
    return this.run(this.shared(agreementContextID), (c) =>
      c.searchDocumentByEmbedding({
        queryEmbedding,
        documentId,
      }),
    );
  }
}
