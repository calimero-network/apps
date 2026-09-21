import { ClientApiDataSource } from './dataSource/ClientApiDataSource';
import { DocumentInfo, Document } from './clientApi';
import { blobClient } from '../lib/node';
import { toBlobIdHex } from '../lib/blobIds';
import { toHexId } from '../lib/participants';
// TODO: Re-enable when AI chatbot is re-implemented
// import { processPDFAndGenerateEmbeddings } from '../services/embeddingService';

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
      // ⚠️ THE CONTEXT IS NOT OPTIONAL. A blob uploaded without one is
      // stored only on the node that took it and is never announced to the
      // agreement's peers — so the upload succeeds, the document appears in
      // the list for everyone, and every other signer gets nothing when they
      // open it. `''` is not "no context", it is a context id of zero length.
      const blobResponse = await blobClient.uploadBlob(
        file,
        onBlobProgress,
        contextId,
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

      // ⚠️ HEX, verbatim from the node. This used to convert to base58,
      // which is what the node later refused to decode. See `lib/blobIds`.
      const blobId = toBlobIdHex(blobResponse.data.blobId);
      if (!blobId) {
        return {
          error: {
            message: `The node returned a blob id this app cannot use: ${blobResponse.data.blobId}`,
          },
        };
      }

      const response = await this.clientApi.uploadDocument(
        contextId,
        name,
        hash,
        blobId,
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

  /**
   * Sign a document as the signed-in person.
   *
   * ⚠️ `signerId` is gone. It used to be `localStorage['agreementContextUserID']`
   * — the context member DEVICE key — handed to a contract that wrote it into
   * the signature unchecked. Two separate faults in one argument: anybody could
   * name anybody, and the value named was the wrong KIND of id, so the recorded
   * signer matched no row of the participant roster. The contract derives the
   * signer from `env::account_id()` now.
   */
  async signDocument(
    contextId: string,
    documentId: string,
    updatedPdfFile: File,
    agreementContextID?: string,
    agreementContextUserID?: string,
    onProgress?: (progress: number) => void,
  ): Promise<{ data?: void; error?: any }> {
    try {
      // Upload the new signed PDF via blob API
      // Announced to the agreement, as above — a signed PDF nobody else can
      // fetch is the failure this app exists to avoid.
      const blobResponse = await blobClient.uploadBlob(
        updatedPdfFile,
        onProgress,
        contextId,
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

      // HEX, as above.
      const blobId = toBlobIdHex(blobResponse.data.blobId);
      if (!blobId) {
        return {
          error: {
            message: `The node returned a blob id this app cannot use: ${blobResponse.data.blobId}`,
          },
        };
      }

      // Call the backend signDocument API with updated PDF data and hash
      const response = await this.clientApi.signDocument(
        contextId,
        documentId,
        blobId,
        updatedPdfFile.size,
        newHash,
        agreementContextID,
        agreementContextUserID,
      );

      if (!response.error) {
        // Recomputes "has everybody signed?" against the participant roster.
        // That comparison could never succeed before: signatures held the device
        // key passed above and the roster holds accounts.
        await this.clientApi.markParticipantSigned(
          contextId,
          documentId,
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

    // ⚠️ HEX, both of them. These were `bs58.encode`, which is the read half
    // of the same defect: the id came back from the contract in the encoding
    // the NODE refuses, so the blob fetch that follows fails with "expected
    // hex". `toBlobIdHex` also accepts a legacy base58 id, so documents
    // recorded by the previous build still open. See `lib/blobIds`.
    const pdfBlobId = toBlobIdHex(
      documentInfo.pdf_blob_id as string | number[],
    );

    // An account id, and hex for the same reason since rc.27 — see the note
    // at the top of `lib/participants`.
    const uploadedBy = toHexId(documentInfo.uploaded_by as string | number[]);

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
