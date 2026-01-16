import { ClientApiDataSource } from './dataSource/ClientApiDataSource';
import { DocumentInfo, Document } from './clientApi';
import { blobClient } from '@calimero-network/calimero-client';
import bs58 from 'bs58';
// TODO: Re-enable when AI chatbot is re-implemented
// import { processPDFAndGenerateEmbeddings } from '../services/embeddingService';

/**
 * Normalize blob ID to base58 format for the contract.
 * The blob API may return hex-encoded IDs (64 chars) or base58 IDs.
 * The contract expects base58-encoded 32-byte blob IDs.
 */
function normalizeBlobIdToBase58(blobId: string): string {
  // Remove any '0x' prefix if present
  const cleanId = blobId.startsWith('0x') ? blobId.slice(2) : blobId;

  // Check if it's a 64-character hex string (32 bytes in hex)
  const isHex = /^[0-9a-fA-F]{64}$/.test(cleanId);

  if (isHex) {
    // Convert hex to bytes, then encode to base58
    const bytes = new Uint8Array(
      cleanId.match(/.{1,2}/g)?.map((byte) => parseInt(byte, 16)) || [],
    );
    return bs58.encode(bytes);
  }

  // Already in base58 or another format - return as-is
  return cleanId;
}

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
    onBlobProgress?: (progress: number) => void,
    onEmbeddingProgress?: (progress: number) => void,
    onStorageProgress?: () => void,
  ): Promise<{ data?: string; error?: any }> {
    try {
      const blobResponse = await blobClient.uploadBlob(
        file,
        onBlobProgress,
        '',
      );

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

      // TODO: Re-enable embedding generation when AI chatbot is re-implemented
      // let embeddings: number[] | undefined;
      // let extractedText: string | undefined;
      // let chunks: any[] | undefined;
      // try {
      //   onEmbeddingProgress?.(0);

      //   onEmbeddingProgress?.(20);
      //   const {
      //     text,
      //     fullTextEmbedding,
      //     chunks: documentChunks,
      //   } = await processPDFAndGenerateEmbeddings(file);

      //   onEmbeddingProgress?.(100);

      //   extractedText = text;
      //   embeddings = fullTextEmbedding;
      //   chunks = documentChunks;
      // } catch (embeddingError) {
      //   console.warn(
      //     'Embedding generation failed, proceeding without embeddings:',
      //     embeddingError,
      //   );
      //   onEmbeddingProgress?.(100);
      // }

      // Report start of storage
      onStorageProgress?.();

      // Set embeddings to undefined since AI chatbot is disabled
      const embeddings: number[] | undefined = undefined;
      const extractedText: string | undefined = undefined;
      const chunks: any[] | undefined = undefined;

      // Normalize blob ID to base58 for the contract
      const base58BlobId = normalizeBlobIdToBase58(blobResponse.data.blobId);

      const response = await this.clientApi.uploadDocument(
        contextId,
        name,
        hash,
        base58BlobId,
        file.size,
        embeddings,
        extractedText,
        chunks,
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

      // Normalize blob ID to base58 for the contract
      const base58BlobId = normalizeBlobIdToBase58(blobResponse.data.blobId);

      // Call the backend signDocument API with updated PDF data and hash
      const response = await this.clientApi.signDocument(
        contextId,
        documentId,
        base58BlobId,
        updatedPdfFile.size,
        newHash,
        signerId,
        agreementContextID,
        agreementContextUserID,
      );

      if (!response.error) {
        await this.clientApi.markParticipantSigned(
          contextId,
          documentId,
          signerId,
          agreementContextID,
          agreementContextUserID,
        );
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

  async searchDocumentByEmbedding(
    queryEmbedding: number[],
    documentId: string,
    agreementContextID?: string,
    agreementContextUserID?: string,
  ): Promise<{ data?: string; error?: any }> {
    try {
      const response = await this.clientApi.searchDocumentByEmbedding(
        queryEmbedding,
        documentId,
        agreementContextID,
        agreementContextUserID,
      );

      return {
        data: response.data || undefined,
        error: response.error,
      };
    } catch (error) {
      console.error(
        'DocumentService: Error in searchDocumentsByEmbedding:',
        error,
      );
      return { error: { message: `Search error: ${error}` } };
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

    // Convert pdf_blob_id from byte array to base58 string if needed
    let pdfBlobId: string;
    if (typeof documentInfo.pdf_blob_id === 'string') {
      pdfBlobId = documentInfo.pdf_blob_id;
    } else if (Array.isArray(documentInfo.pdf_blob_id)) {
      // pdf_blob_id is a byte array from the contract, convert to base58
      pdfBlobId = bs58.encode(new Uint8Array(documentInfo.pdf_blob_id));
    } else {
      // Fallback - try to use as-is
      pdfBlobId = String(documentInfo.pdf_blob_id);
    }

    // Convert uploaded_by from byte array to base58 string if needed
    let uploadedBy: string;
    if (typeof documentInfo.uploaded_by === 'string') {
      uploadedBy = documentInfo.uploaded_by;
    } else if (Array.isArray(documentInfo.uploaded_by)) {
      uploadedBy = bs58.encode(new Uint8Array(documentInfo.uploaded_by));
    } else {
      uploadedBy = String(documentInfo.uploaded_by);
    }

    return {
      id: documentInfo.id,
      name: documentInfo.name,
      size: this.formatFileSize(documentInfo.size),
      uploadedAt: uploadedAtStr,
      status: documentInfo.status,
      uploadedBy: uploadedBy,
      hash: documentInfo.hash,
      pdfBlobId: pdfBlobId,
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
