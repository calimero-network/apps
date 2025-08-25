import { ClientApiDataSource } from './dataSource/ClientApiDataSource';
import { DocumentInfo, Document } from './clientApi';
import { blobClient } from '@calimero-network/calimero-client';
import { backendService } from './icp/backendService';

export class DocumentService {
  private clientApi: ClientApiDataSource;

  constructor() {
    this.clientApi = new ClientApiDataSource();
  }

  async uploadDocument(
    contextId: string,
    name: string,
    file: File,
    agreementContextID?: string,
    agreementContextUserID?: string,
    onProgress?: (progress: number) => void,
    icpIdentity?: any,
  ): Promise<{ data?: string; error?: any }> {
    try {
      const blobResponse = await blobClient.uploadBlob(file, onProgress, '');

      if (blobResponse.error) {
        console.error(
          `Upload failed for ${file.name}:`,
          blobResponse.error.message,
        );
        return { error: blobResponse.error };
      }

      if (!blobResponse.data?.blobId) {
        console.error(`Failed to get blob ID from upload for ${file.name}`);
        return { error: { message: 'Failed to get blob ID from upload' } };
      }

      // Calculate hash from file for verification
      const arrayBuffer = await file.arrayBuffer();
      const pdfData = new Uint8Array(arrayBuffer);
      const hash = await this.calculateFileHash(pdfData);

      // Register the document with the backend using the blob ID
      const response = await this.clientApi.uploadDocument(
        contextId,
        name,
        hash,
        blobResponse.data.blobId,
        file.size,
        agreementContextID,
        agreementContextUserID,
      );

      return {
        data: response.data || undefined,
        error: response.error,
      };
    } catch (error) {
      console.error(`Upload error for ${file.name}:`, error);
      return { error: { message: `Upload error: ${error}` } };
    }
  }

  async listDocuments(
    contextId: string,
    agreementContextID?: string,
    agreementContextUserID?: string,
  ): Promise<{ data?: Document[]; error?: any }> {
    try {
      const response = await this.clientApi.listDocuments(
        contextId,
        agreementContextID,
        agreementContextUserID,
      );

      if (response.error) {
        return { error: response.error };
      }

      const documents: DocumentInfo[] = response.data || [];
      const formattedDocuments: Document[] = documents.map((doc) =>
        this.formatDocument(doc),
      );

      return { data: formattedDocuments };
    } catch (error) {
      console.error('Error listing documents:', error);
      return { error: { message: 'Failed to list documents' } };
    }
  }

  async signDocument(
    contextId: string,
    documentId: string,
    updatedPdfFile: File,
    signerId: string,
    agreementContextID?: string,
    agreementContextUserID?: string,
    onProgress?: (progress: number) => void,
    icpIdentity?: any, // Pass ICP identity from outside
  ): Promise<{ data?: void; error?: any }> {
    try {
      // Upload the new signed PDF via blob API
      const blobResponse = await blobClient.uploadBlob(
        updatedPdfFile,
        onProgress,
        '',
      );

      if (blobResponse.error) {
        console.error(
          `Upload failed for signed PDF:`,
          blobResponse.error.message,
        );
        return { error: blobResponse.error };
      }

      if (!blobResponse.data?.blobId) {
        console.error(`Failed to get blob ID from upload for signed PDF`);
        return { error: { message: 'Failed to get blob ID from upload' } };
      }

      // Calculate hash from file for verification
      const arrayBuffer = await updatedPdfFile.arrayBuffer();
      const updatedPdfData = new Uint8Array(arrayBuffer);
      const newHash = await this.calculateFileHash(updatedPdfData);

      // Call the backend signDocument API with updated PDF data and hash
      const response = await this.clientApi.signDocument(
        contextId,
        documentId,
        blobResponse.data.blobId,
        updatedPdfFile.size,
        newHash,
        signerId,
        agreementContextID,
        agreementContextUserID,
      );

      if (!response.error) {
        const markSignedResp = await this.clientApi.markParticipantSigned(
          contextId,
          documentId,
          signerId,
          agreementContextID,
          agreementContextUserID,
        );

        if (!markSignedResp?.error) {
          // --- ICP CANISTER INTEGRATION ---
          // On successful sign and mark, also upload the final hash to ICP canister
          try {
            const safeDocumentId = this.sanitizeDocumentId(documentId);
            const icpApi = await backendService(icpIdentity);

            // Call the canister signDocument which returns a boolean success flag.
            const signSuccess = await icpApi.signDocument({
              document_id: safeDocumentId,
              consent_acknowledged: true,
            });

            if (signSuccess) {
              // Only record the final hash if the canister sign succeeded.
              const icpResponse = await icpApi.recordFinalHash(
                safeDocumentId,
                newHash,
              );

              if (icpResponse && (icpResponse as any).error) {
                console.warn(
                  'ICP Backend: recordFinalHash returned error',
                  icpResponse,
                );
              } else {
                console.log('ICP Backend: recorded final hash', icpResponse);
              }
            } else {
              console.warn(
                'ICP Backend: signDocument returned false — skipping recordFinalHash',
              );
            }
          } catch (icpError) {
            console.error(
              'ICP Backend: Failed to record signature/final hash:',
              icpError,
            );
          }
          // --- END ICP CANISTER INTEGRATION ---
        } else {
          console.error(
            'Failed to mark participant as signed:',
            markSignedResp.error,
          );
        }
      }

      return {
        data: response.data === null ? undefined : response.data,
        error: response.error,
      };
    } catch (error) {
      console.error('Error signing document:', error);
      return { error: { message: 'Failed to sign document' } };
    }
  }

  async verifyDocumentWithICP(
    documentId: string,
    hash: string,
    icpIdentity?: any,
  ): Promise<{
    status?: string;
    verified?: boolean;
    message?: string;
    error?: any;
  }> {
    try {
      const safeDocumentId = this.sanitizeDocumentId(documentId);
      console.log(
        `Verifying document with ICP canister: ${safeDocumentId}, hash: ${hash}`,
      );
      const icpApi = await backendService(icpIdentity);
      const statusResult = await icpApi.verifyHash(safeDocumentId, hash);
      console.log('ICP canister verifyHash response:', statusResult);

      // Determine verification result and user-friendly message
      let verified = false;
      let status: string | undefined = undefined;
      let message: string | undefined = undefined;

      if (statusResult && typeof statusResult === 'object') {
        const key = Object.keys(statusResult)[0];
        status = key;
        if (key === 'FinalMatch') {
          verified = true;
          message =
            'This document is verified and matches the final signed version on ICP.';
        } else if (key === 'OriginalMatch') {
          verified = true;
          message =
            'This document matches the original uploaded version on ICP.';
        } else if (key === 'NoMatch') {
          message = 'This document does not match any version recorded on ICP.';
        } else if (key === 'Unrecorded') {
          message = 'This document has not been recorded on ICP.';
        }
      } else if (typeof statusResult === 'string') {
        status = statusResult;
        message = statusResult;
      }

      return { status, verified, message };
    } catch (error) {
      console.error('Failed to verify document with ICP canister:', error);
      return {
        error: { message: 'Failed to verify document with ICP canister.' },
        verified: false,
        message: 'Verification failed due to an error.',
      };
    }
  }

  private formatDocument(documentInfo: DocumentInfo): Document {
    const uploadedAtMs = Math.floor(
      Number(documentInfo.uploaded_at) / 1_000_000,
    );

    const dateObj = new Date(uploadedAtMs);
    const uploadedAtStr = dateObj.toLocaleString(undefined, {
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });

    return {
      id: documentInfo.id,
      name: documentInfo.name,
      size: this.formatFileSize(documentInfo.size),
      uploadedAt: uploadedAtStr,
      status: documentInfo.status,
      uploadedBy: documentInfo.uploaded_by,
      hash: documentInfo.hash,
      pdfBlobId: documentInfo.pdf_blob_id,
    };
  }

  private formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  private async calculateFileHash(data: Uint8Array): Promise<string> {
    const buffer = new Uint8Array(data);
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  private sanitizeDocumentId(documentId: string): string {
    return documentId.replace(/[^a-zA-Z0-9_-]/g, '_');
  }
}
