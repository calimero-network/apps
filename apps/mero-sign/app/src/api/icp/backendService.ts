import { createBackendActor } from './backendActor';
import {
  DocumentRecord,
  DocumentUploadRequest,
  SigningRequest,
  AuditEntry,
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
  const actor = await createBackendActor(identity);

  return {
    raw: {
      uploadDocument: (request: DocumentUploadRequest) =>
        actor.upload_document(request) as Promise<BackendResult<null>>,

      getDocumentRecord: (documentId: string) =>
        actor.get_document_record(documentId) as Promise<
          BackendResult<DocumentRecord>
        >,

      getDocumentStatus: (documentId: string) =>
        actor.get_document_status(documentId) as Promise<
          BackendResult<DocumentStatus>
        >,

      getSigningProgress: (documentId: string) =>
        actor.get_signing_progress(documentId) as Promise<
          BackendResult<[string[], string[]]>
        >,

      getHashes: (documentId: string) =>
        actor.get_hashes(documentId) as Promise<BackendResult<DocumentRecord>>,

      recordFinalHash: (documentId: string, hash: string) =>
        actor.record_final_hash(documentId, hash) as Promise<
          BackendResult<null>
        >,

      recordOriginalHash: (documentId: string, hash: string) =>
        actor.record_original_hash(documentId, hash) as Promise<
          BackendResult<null>
        >,

      verifyHash: (documentId: string, hashToCheck: string) =>
        actor.verify_hash(
          documentId,
          hashToCheck,
        ) as Promise<VerificationStatus>,

      addParticipant: (documentId: string, participantId: string) =>
        actor.add_participant(documentId, participantId) as Promise<
          BackendResult<null>
        >,

      recordConsent: (documentId: string) =>
        actor.record_consent(documentId) as Promise<BackendResult<null>>,

      signDocument: (request: SigningRequest) =>
        actor.sign_document(request) as Promise<BackendResult<null>>,

      getAuditTrail: (documentId: string) =>
        actor.get_audit_trail(documentId) as Promise<
          BackendResult<AuditEntry[]>
        >,
    },

    // Backward compatible methods (for existing code)
    // getHashes: async (documentId: string): Promise<DocumentRecord> => {
    //   const result = (await actor.get_hashes(
    //     documentId,
    //   )) as BackendResult<DocumentRecord>;
    //   return handleBackendResult(result);
    // },

    recordFinalHash: async (documentId: string, hash: string): Promise<any> => {
      const result = (await actor.record_final_hash(
        documentId,
        hash,
      )) as BackendResult<null>;
      const handled = safeHandleBackendResult(result);
      return handled.success ? { success: true } : { error: handled.error };
    },

    recordOriginalHash: async (
      documentId: string,
      hash: string,
    ): Promise<any> => {
      const result = (await actor.record_original_hash(
        documentId,
        hash,
      )) as BackendResult<null>;
      const handled = safeHandleBackendResult(result);
      return handled.success ? { success: true } : { error: handled.error };
    },

    verifyHash: async (
      documentId: string,
      hashToCheck: string,
    ): Promise<VerificationStatus> => {
      return (await actor.verify_hash(
        documentId,
        hashToCheck,
      )) as VerificationStatus;
    },

    async uploadDocument(request: DocumentUploadRequest): Promise<void> {
      const result = await this.raw.uploadDocument(request);
      handleBackendResult(result);
    },

    // async getDocumentRecord(
    //   documentId: string,
    // ): Promise<DocumentRecord | null> {
    //   const result = await this.raw.getDocumentRecord(documentId);
    //   const handled = safeHandleBackendResult(result);
    //   return handled.success ? handled.data! : null;
    // },

    // async getDocumentStatus(
    //   documentId: string,
    // ): Promise<DocumentStatus | null> {
    //   const result = await this.raw.getDocumentStatus(documentId);
    //   const handled = safeHandleBackendResult(result);
    //   return handled.success ? handled.data! : null;
    // },

    // async getSigningProgress(documentId: string): Promise<{
    //   requiredSigners: string[];
    //   currentSigners: string[];
    //   isComplete: boolean;
    // } | null> {
    //   const result = await this.raw.getSigningProgress(documentId);
    //   const handled = safeHandleBackendResult(result);

    //   if (!handled.success || !handled.data) return null;

    //   const [requiredSigners, currentSigners] = handled.data;
    //   const isComplete = requiredSigners.every((signer) =>
    //     currentSigners.includes(signer),
    //   );

    //   return { requiredSigners, currentSigners, isComplete };
    // },

    // async getDocumentHashes(documentId: string): Promise<{
    //   original: { hash: string; timestamp: Date };
    //   final?: { hash: string; timestamp: Date };
    // } | null> {
    //   const result = await this.raw.getHashes(documentId);
    //   const handled = safeHandleBackendResult(result);

    //   if (!handled.success || !handled.data) return null;

    //   const record = handled.data;
    //   return {
    //     original: {
    //       hash: record.original_hash,
    //       timestamp: bigintToDate(record.timestamp_original),
    //     },
    //     final: record.final_hash
    //       ? {
    //           hash: record.final_hash,
    //           timestamp: bigintToDate(record.timestamp_final!),
    //         }
    //       : undefined,
    //   };
    // },

    // async verifyDocumentHash(
    //   documentId: string,
    //   hashToCheck: string,
    // ): Promise<{
    //   status: VerificationStatus;
    //   isValid: boolean;
    //   matchType?: 'original' | 'final';
    // }> {
    //   const status = await this.raw.verifyHash(documentId, hashToCheck);

    //   return {
    //     status,
    //     isValid:
    //       status === VerificationStatus.OriginalMatch ||
    //       status === VerificationStatus.FinalMatch,
    //     matchType:
    //       status === VerificationStatus.OriginalMatch
    //         ? 'original'
    //         : status === VerificationStatus.FinalMatch
    //           ? 'final'
    //           : undefined,
    //   };
    // },

    // async addParticipant(
    //   documentId: string,
    //   participantId: string,
    // ): Promise<boolean> {
    //   const result = await this.raw.addParticipant(documentId, participantId);
    //   return isBackendSuccess(result);
    // },

    async recordConsent(documentId: string): Promise<boolean> {
      const result = await this.raw.recordConsent(documentId);
      return isBackendSuccess(result);
    },

    async signDocument(request: SigningRequest): Promise<boolean> {
      const result = await this.raw.signDocument(request);
      return isBackendSuccess(result);
    },

    // async signDocumentWithConsent(
    //   documentId: string,
    //   signatureMetadata?: string,
    // ): Promise<{ success: boolean; error?: string }> {
    //   try {
    //     // First record consent
    //     const consentResult = await this.raw.recordConsent(documentId);
    //     if (!isBackendSuccess(consentResult)) {
    //       return { success: false, error: 'Failed to record consent' };
    //     }

    //     const signResult = await this.raw.signDocument({
    //       document_id: documentId,
    //       consent_acknowledged: true,
    //       signature_metadata: signatureMetadata,
    //     });

    //     if (!isBackendSuccess(signResult)) {
    //       return { success: false, error: 'Failed to sign document' };
    //     }

    //     return { success: true };
    //   } catch (error) {
    //     return {
    //       success: false,
    //       error: error instanceof Error ? error.message : 'Unknown error',
    //     };
    //   }
    // },

    async getAuditTrail(documentId: string): Promise<{
      entries: Array<AuditEntry & { timestampDate: Date }>;
      total: number;
    } | null> {
      console.log(
        '🔧 BackendService.getAuditTrail called with Sanitized Document ID:',
        documentId,
      );

      const result = await this.raw.getAuditTrail(documentId);
      console.log('🔧 Raw result from ICP canister:', result);

      const handled = safeHandleBackendResult(result);
      console.log('🔧 Handled result:', handled);

      if (!handled.success || !handled.data) {
        console.log('❌ No successful result or data:', {
          success: handled.success,
          hasData: !!handled.data,
        });
        return null;
      }

      console.log('✅ Processing audit entries, count:', handled.data.length);
      const entries = handled.data.map((entry) => {
        console.log('🔧 Processing entry:', entry);
        const processedEntry = {
          ...entry,
          timestampDate: bigintToDate(entry.timestamp),
        };
        console.log('🔧 Processed entry:', processedEntry);
        return processedEntry;
      });

      const result_final = { entries, total: entries.length };
      console.log('🔧 Final audit trail result:', result_final);
      return result_final;
    },

    // async getDocumentMetadata(documentId: string): Promise<{
    //   title?: string;
    //   description?: string;
    //   documentType?: string;
    //   createdAt: Date;
    //   expiresAt?: Date;
    // } | null> {
    //   const record = await this.getDocumentRecord(documentId);
    //   if (!record) return null;

    //   return {
    //     title: record.metadata.title,
    //     description: record.metadata.description,
    //     documentType: record.metadata.document_type,
    //     createdAt: bigintToDate(record.metadata.created_at),
    //     expiresAt: record.metadata.expires_at
    //       ? bigintToDate(record.metadata.expires_at)
    //       : undefined,
    //   };
    // },

    // async isDocumentExpired(documentId: string): Promise<boolean> {
    //   const metadata = await this.getDocumentMetadata(documentId);
    //   if (!metadata || !metadata.expiresAt) return false;
    //   return new Date() > metadata.expiresAt;
    // },

    // async canUserSign(
    //   documentId: string,
    //   userId: string,
    // ): Promise<{
    //   canSign: boolean;
    //   reason?: string;
    // }> {
    //   const record = await this.getDocumentRecord(documentId);
    //   if (!record) {
    //     return { canSign: false, reason: 'Document not found' };
    //   }

    //   if (record.document_status === DocumentStatus.FullySigned) {
    //     return { canSign: false, reason: 'Document is already fully signed' };
    //   }

    //   if (userId !== record.admin_id && !record.participants.includes(userId)) {
    //     return {
    //       canSign: false,
    //       reason: 'User is not authorized to sign this document',
    //     };
    //   }

    //   if (record.current_signers.includes(userId)) {
    //     return {
    //       canSign: false,
    //       reason: 'User has already signed this document',
    //     };
    //   }

    //   const isExpired = await this.isDocumentExpired(documentId);
    //   if (isExpired) {
    //     return { canSign: false, reason: 'Document has expired' };
    //   }

    //   return { canSign: true };
    // },
  };
};
