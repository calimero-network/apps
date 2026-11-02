import { ClientApiDataSource } from './dataSource/ClientApiDataSource';
import type { Document, DocumentInfo, ErrorResponse } from './clientApi';
import { sha256Hex } from '../lib/documentIntegrity';
import type { Conn } from '../lib/conn';

/**
 * Documents as files: the PDF is uploaded as a blob of the agreement's app,
 * and the contract records its SHA-256 (which is the blob's id, and which the
 * contract checks) beside it. A signature is a new PDF with the signer's mark,
 * uploaded the same way and recorded against the version it was made from.
 */
export class DocumentService {
  private clientApi: ClientApiDataSource;

  /** `conn` defaults to the signed-in session of `CalimeroProvider`. */
  constructor(conn?: Conn | null) {
    this.clientApi = new ClientApiDataSource(conn);
  }

  async uploadDocument(
    contextId: string,
    name: string,
    file: File,
    agreementContextID?: string,
    _agreementContextUserID?: string,
  ): Promise<{ data?: string; error?: ErrorResponse }> {
    const app = agreementContextID || contextId;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const hash = await sha256Hex(bytes.buffer);
    const blob = await this.clientApi.uploadBlob(bytes, app);
    if (blob.error) return { error: blob.error };
    // The search content stays off while the legal assistant cannot answer
    // (`LEGAL_ASSISTANT_ENABLED`); the contract takes it when it comes back.
    const response = await this.clientApi.uploadDocument(
      app,
      name,
      hash,
      blob.data.id,
      bytes.length,
      undefined,
      undefined,
      undefined,
      app,
    );
    return response.error ? { error: response.error } : { data: response.data };
  }

  async listDocuments(
    contextId: string,
    agreementContextID?: string,
    _agreementContextUserID?: string,
  ): Promise<{ data?: Document[]; error?: ErrorResponse }> {
    const response = await this.clientApi.listDocuments(contextId, agreementContextID);
    if (response.error) return { error: response.error };
    return { data: response.data.map((doc) => this.formatDocument(doc)) };
  }

  /**
   * Sign as the signed-in person: upload the PDF with their mark, then record
   * it as made from `baseHash`, the version they opened. The node asks for
   * their passkey (a fresh confirmation); the contract refuses a stale base.
   */
  async signDocument(
    contextId: string,
    documentId: string,
    baseHash: string,
    updatedPdfFile: File,
    agreementContextID?: string,
    _agreementContextUserID?: string,
  ): Promise<{ data?: void; error?: ErrorResponse }> {
    const app = agreementContextID || contextId;
    const bytes = new Uint8Array(await updatedPdfFile.arrayBuffer());
    const newHash = await sha256Hex(bytes.buffer);
    const blob = await this.clientApi.uploadBlob(bytes, app);
    if (blob.error) return { error: blob.error };
    const response = await this.clientApi.signDocument(
      app,
      documentId,
      baseHash,
      blob.data.id,
      bytes.length,
      newHash,
      app,
    );
    if (response.error) return { error: response.error };
    await this.clientApi.markParticipantSigned(app, documentId, app);
    return {};
  }

  async searchDocumentByEmbedding(
    queryEmbedding: number[],
    documentId: string,
    agreementContextID?: string,
    _agreementContextUserID?: string,
  ): Promise<{ data?: string; error?: ErrorResponse }> {
    const response = await this.clientApi.searchDocumentByEmbedding(
      queryEmbedding,
      documentId,
      agreementContextID,
    );
    return response.error ? { error: response.error } : { data: response.data };
  }

  /** The PDF of a document's current version, from the agreement's blobs. */
  async downloadDocument(app: string, blobId: string): Promise<Blob> {
    const res = await this.clientApi.downloadBlob(blobId, app);
    if (res.error) throw new Error(res.error.message);
    return new Blob([res.data as BlobPart], { type: 'application/pdf' });
  }

  private formatDocument(documentInfo: DocumentInfo): Document {
    const uploadedAtStr = new Date(documentInfo.uploaded_at).toLocaleString(undefined, {
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
      size: formatFileSize(documentInfo.size),
      uploadedAt: uploadedAtStr,
      status: documentInfo.status,
      uploadedBy: documentInfo.uploaded_by,
      hash: documentInfo.hash,
      pdfBlobId: documentInfo.pdf_blob_id,
    };
  }
}

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}
