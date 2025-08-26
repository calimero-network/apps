import { createBackendActor, getAuthClient } from './backendActor';
import { authService } from '../../contexts/IcpAuthContext';
import {
  ContextRecord,
  DocumentRecord,
  CreateContextRequest,
  DocumentUploadRequest,
  SigningRequest,
  AuditEntry,
  ContextStatus,
  DocumentStatus,
  VerificationStatus,
  BackendResult,
} from './types';
import {
  handleBackendResult,
  safeHandleBackendResult,
  isBackendSuccess,
  bigintToDate,
} from './utils';

export const backendService = async (identity?: any) => {
  let identityToUse = identity;

  if (!identityToUse) {
    try {
      const uiState = authService.getAuthState();
      if (uiState?.isAuthenticated && uiState.identity) {
        identityToUse = uiState.identity;
      } else {
        const authClient = await getAuthClient();
        if (await authClient.isAuthenticated()) {
          identityToUse = await authClient.getIdentity();
        }
      }
    } catch (err) {
      console.debug(
        'backendService: failed to resolve identity from authService/getAuthClient',
        err,
      );
    }
  }

  const actor = await createBackendActor(identityToUse);

  return {
    raw: {
      // Context management
      createContext: (request: CreateContextRequest) =>
        actor.create_context(request) as Promise<BackendResult<null>>,

      getContext: (contextId: string) =>
        actor.get_context(contextId) as Promise<BackendResult<ContextRecord>>,

      addParticipantToContext: (contextId: string, participantId: string) =>
        actor.add_participant_to_context(contextId, participantId) as Promise<
          BackendResult<null>
        >,

      // Document management
      uploadDocument: (request: DocumentUploadRequest) =>
        actor.upload_document_to_context(request) as Promise<
          BackendResult<null>
        >,

      getDocument: (documentId: string) =>
        actor.get_document(documentId) as Promise<
          BackendResult<DocumentRecord>
        >,

      getContextDocuments: (contextId: string) =>
        actor.get_context_documents(contextId) as Promise<
          BackendResult<DocumentRecord[]>
        >,

      recordFinalHash: (documentId: string, hash: string) =>
        actor.record_final_hash(documentId, hash) as Promise<
          BackendResult<null>
        >,

      // Consent and signing (updated to include document-specific consent)
      recordConsentForContext: (contextId: string, documentId: string) =>
        actor.record_consent_for_context(contextId, documentId) as Promise<
          BackendResult<null>
        >,

      signDocument: (request: SigningRequest) =>
        actor.sign_document(request) as Promise<BackendResult<null>>,

      // Query functions
      getSigningProgress: (contextId: string) =>
        actor.get_context_signing_progress(contextId) as Promise<
          BackendResult<[string[], string[], Array<[string, DocumentStatus]>]>
        >,

      verifyHash: (documentId: string, hashToCheck: string) =>
        actor.verify_document_hash(
          documentId,
          hashToCheck,
        ) as Promise<VerificationStatus>,

      getAuditTrail: (contextId: string) =>
        actor.get_audit_trail(contextId) as Promise<
          BackendResult<AuditEntry[]>
        >,

      getAuditTrailForDocument: (contextId: string, documentId: string) =>
        actor.get_audit_trail_for_document(contextId, documentId) as Promise<
          BackendResult<AuditEntry[]>
        >,

      isUserContextParticipant: (contextId: string, userId: string) =>
        actor.is_user_context_participant(
          contextId,
          userId,
        ) as Promise<boolean>,

      hasUserConsented: (
        contextId: string,
        userId: string,
        documentId: string,
      ) =>
        actor.has_user_consented(
          contextId,
          userId,
          documentId,
        ) as Promise<boolean>,
    },

    // High-level service methods
    async createContext(request: CreateContextRequest): Promise<void> {
      const result = await this.raw.createContext(request);
      handleBackendResult(result);
    },

    async getContext(contextId: string): Promise<ContextRecord | null> {
      const result = await this.raw.getContext(contextId);
      const handled = safeHandleBackendResult(result);
      return handled.success ? handled.data! : null;
    },

    async uploadDocument(request: DocumentUploadRequest): Promise<void> {
      const result = await this.raw.uploadDocument(request);
      handleBackendResult(result);
    },

    async getDocument(documentId: string): Promise<DocumentRecord | null> {
      const result = await this.raw.getDocument(documentId);
      const handled = safeHandleBackendResult(result);
      return handled.success ? handled.data! : null;
    },

    async getContextDocuments(contextId: string): Promise<DocumentRecord[]> {
      const result = await this.raw.getContextDocuments(contextId);
      const handled = safeHandleBackendResult(result);
      return handled.success && handled.data ? handled.data : [];
    },

    async recordFinalHash(documentId: string, hash: string): Promise<any> {
      const result = await this.raw.recordFinalHash(documentId, hash);
      const handled = safeHandleBackendResult(result);
      return handled.success ? { success: true } : { error: handled.error };
    },

    async verifyHash(
      documentId: string,
      hashToCheck: string,
    ): Promise<VerificationStatus> {
      return await this.raw.verifyHash(documentId, hashToCheck);
    },

    async addParticipantToContext(
      contextId: string,
      participantId: string,
    ): Promise<boolean> {
      const result = await this.raw.addParticipantToContext(
        contextId,
        participantId,
      );
      return isBackendSuccess(result);
    },

    // Updated to require documentId for document-specific consent
    async recordConsentForContext(
      contextId: string,
      documentId: string,
    ): Promise<boolean> {
      const result = await this.raw.recordConsentForContext(
        contextId,
        documentId,
      );

      return isBackendSuccess(result);
    },

    async signDocument(request: SigningRequest): Promise<boolean> {
      const result = await this.raw.signDocument(request);
      return isBackendSuccess(result);
    },

    async getSigningProgress(contextId: string): Promise<{
      requiredSigners: string[];
      consentedUsers: string[];
      documentStatuses: Array<[string, DocumentStatus]>;
    } | null> {
      const result = await this.raw.getSigningProgress(contextId);
      const handled = safeHandleBackendResult(result);

      if (!handled.success || !handled.data) return null;

      const [requiredSigners, consentedUsers, documentStatuses] = handled.data;

      return { requiredSigners, consentedUsers, documentStatuses };
    },

    async getAuditTrail(contextId: string): Promise<{
      entries: Array<AuditEntry & { timestampDate: Date }>;
      total: number;
    } | null> {
      const result = await this.raw.getAuditTrail(contextId);

      const handled = safeHandleBackendResult(result);

      if (!handled.success || !handled.data) {
        return null;
      }

      const entries = handled.data.map((entry) => {
        const processedEntry = {
          ...entry,
          timestampDate: bigintToDate(entry.timestamp),
        };

        return processedEntry;
      });

      const result_final = { entries, total: entries.length };

      return result_final;
    },

    async getAuditTrailDocument(
      contextId: string,
      documentId: string,
    ): Promise<{
      entries: Array<AuditEntry & { timestampDate: Date }>;
      total: number;
    } | null> {
      const result = await (this.raw.getAuditTrailForDocument
        ? this.raw.getAuditTrailForDocument(contextId, documentId)
        : this.raw.getAuditTrail(contextId));

      const handled = safeHandleBackendResult(result);

      if (!handled.success || !handled.data) {
        return null;
      }

      const entries = handled.data.map((entry) => {
        const processedEntry = {
          ...entry,
          timestampDate: bigintToDate(entry.timestamp),
        };

        return processedEntry;
      });

      const result_final = { entries, total: entries.length };

      return result_final;
    },

    async isUserContextParticipant(
      contextId: string,
      userId: string,
    ): Promise<boolean> {
      return await this.raw.isUserContextParticipant(contextId, userId);
    },

    async hasUserConsented(
      contextId: string,
      userId: string,
      documentId: string,
    ): Promise<boolean> {
      return await this.raw.hasUserConsented(contextId, userId, documentId);
    },

    // Helper methods
    async getDocumentHashes(documentId: string): Promise<{
      original: { hash: string; timestamp: Date };
      final?: { hash: string; timestamp: Date };
    } | null> {
      const document = await this.getDocument(documentId);
      if (!document) return null;

      return {
        original: {
          hash: document.original_hash,
          timestamp: bigintToDate(document.timestamp_original),
        },
        final: document.final_hash
          ? {
              hash: document.final_hash,
              timestamp: bigintToDate(document.timestamp_final!),
            }
          : undefined,
      };
    },

    async verifyDocumentHash(
      documentId: string,
      hashToCheck: string,
    ): Promise<{
      status: VerificationStatus;
      isValid: boolean;
      matchType?: 'original' | 'final';
    }> {
      const status = await this.raw.verifyHash(documentId, hashToCheck);

      return {
        status,
        isValid:
          status === VerificationStatus.OriginalMatch ||
          status === VerificationStatus.FinalMatch,
        matchType:
          status === VerificationStatus.OriginalMatch
            ? 'original'
            : status === VerificationStatus.FinalMatch
              ? 'final'
              : undefined,
      };
    },

    // Updated to check document-specific consent
    async canUserSign(
      documentId: string,
      userId: string,
    ): Promise<{
      canSign: boolean;
      reason?: string;
    }> {
      const document = await this.getDocument(documentId);
      if (!document) {
        return { canSign: false, reason: 'Document not found' };
      }

      if (document.document_status === DocumentStatus.FullySigned) {
        return { canSign: false, reason: 'Document is already fully signed' };
      }

      const isParticipant = await this.isUserContextParticipant(
        document.context_id,
        userId,
      );
      if (!isParticipant) {
        return {
          canSign: false,
          reason: 'User is not authorized to sign this document',
        };
      }

      if (document.current_signers.includes(userId)) {
        return {
          canSign: false,
          reason: 'User has already signed this document',
        };
      }

      // Check document-specific consent
      const hasConsented = await this.hasUserConsented(
        document.context_id,
        userId,
        documentId,
      );
      if (!hasConsented) {
        return {
          canSign: false,
          reason: 'User must give consent for this document before signing',
        };
      }

      return { canSign: true };
    },

    // Updated to use document-specific consent workflow
    async signDocumentWithConsent(
      documentId: string,
    ): Promise<{ success: boolean; error?: string }> {
      try {
        const document = await this.getDocument(documentId);
        if (!document) {
          return { success: false, error: 'Document not found' };
        }

        // Record consent for this specific document
        const consentSuccess = await this.recordConsentForContext(
          document.context_id,
          documentId,
        );
        if (!consentSuccess) {
          return {
            success: false,
            error: 'Failed to record consent for document',
          };
        }

        // Then sign the document
        const signSuccess = await this.signDocument({
          document_id: documentId,
          consent_acknowledged: true,
        });

        if (!signSuccess) {
          return { success: false, error: 'Failed to sign document' };
        }

        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    },

    // Get consent status for all documents in a context for a specific user
    async getDocumentConsentStatus(
      contextId: string,
      userId: string,
    ): Promise<Record<string, boolean>> {
      const documents = await this.getContextDocuments(contextId);
      const consentStatus: Record<string, boolean> = {};

      for (const document of documents) {
        const hasConsented = await this.hasUserConsented(
          contextId,
          userId,
          document.document_id,
        );
        consentStatus[document.document_id] = hasConsented;
      }

      return consentStatus;
    },

    // Get signing status for all documents in a context for a specific user
    async getDocumentSigningStatus(
      contextId: string,
      userId: string,
    ): Promise<
      Record<string, { consented: boolean; signed: boolean; canSign: boolean }>
    > {
      const documents = await this.getContextDocuments(contextId);
      const status: Record<
        string,
        { consented: boolean; signed: boolean; canSign: boolean }
      > = {};

      for (const document of documents) {
        const consented = await this.hasUserConsented(
          contextId,
          userId,
          document.document_id,
        );
        const signed = document.current_signers.includes(userId);
        const canSignResult = await this.canUserSign(
          document.document_id,
          userId,
        );

        status[document.document_id] = {
          consented,
          signed,
          canSign: canSignResult.canSign,
        };
      }

      return status;
    },
  };
};
