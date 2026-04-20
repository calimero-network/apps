import { blobClient } from '@calimero-network/calimero-client';
import { getNodeEndpoint, getAdminHeaders } from './AdminApi';
import { buildContextIdCandidates } from './contextIdJoin';

export interface UploadResult {
  blobId: string;
  size: number;
}

export class FileBlobManager {
  async uploadFile(
    file: File,
    onProgress?: (progress: number) => void,
  ): Promise<UploadResult> {
    const res = await blobClient.uploadBlob(file, onProgress);
    if (res.error || !res.data) {
      throw new Error(res.error?.message || 'Blob upload failed');
    }
    const parsed = this.parseUploadPayload(res.data);
    if (parsed) return parsed;

    // Fallback: some client/runtime wrappers return inconsistent upload
    // payload shapes. Use direct admin API upload to get canonical response.
    console.warn(
      '[FileBlobManager] Unexpected blobClient upload payload shape, using direct admin upload fallback.',
      res.data,
    );
    return this.uploadViaAdminApi(file);
  }

  private parseUploadPayload(data: unknown): UploadResult | null {
    const payload = this.extractBlobPayload(data);
    const blobId = payload?.blobId ?? payload?.blob_id;
    const rawSize = payload?.size;
    const size =
      typeof rawSize === 'number'
        ? rawSize
        : typeof rawSize === 'string'
          ? Number(rawSize)
          : typeof rawSize === 'bigint'
            ? Number(rawSize)
            : NaN;
    if (!blobId || !Number.isFinite(size)) {
      return null;
    }
    return { blobId, size };
  }

  private async uploadViaAdminApi(file: File): Promise<UploadResult> {
    const url = `${getNodeEndpoint()}/admin-api/blobs`;
    const response = await fetch(url, {
      method: 'PUT',
      headers: getAdminHeaders({ 'Content-Type': 'application/octet-stream' }),
      body: await file.arrayBuffer(),
    });

    if (!response.ok) {
      throw new Error(
        `Blob upload failed: ${response.status} ${response.statusText}`,
      );
    }

    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    const parsed = this.parseUploadPayload(payload);
    if (!parsed) {
      console.error(
        '[FileBlobManager] Failed to parse direct blob upload payload.',
        payload,
      );
      throw new Error('Blob upload returned an invalid response payload.');
    }
    return parsed;
  }

  private extractBlobPayload(
    data: unknown,
  ): { blobId?: string; blob_id?: string; size?: number | string } | null {
    if (typeof data === 'string') {
      try {
        return this.extractBlobPayload(JSON.parse(data));
      } catch {
        return null;
      }
    }

    const queue: unknown[] = [data];
    const seen = new Set<unknown>();

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current || typeof current !== 'object' || seen.has(current)) {
        continue;
      }
      seen.add(current);

      const candidate = current as {
        blobId?: unknown;
        blob_id?: unknown;
        size?: unknown;
      };
      const blobId =
        typeof candidate.blobId === 'string'
          ? candidate.blobId
          : typeof candidate.blob_id === 'string'
            ? candidate.blob_id
            : null;

      if (blobId !== null) {
        return {
          blobId:
            typeof candidate.blobId === 'string' ? candidate.blobId : undefined,
          blob_id:
            typeof candidate.blob_id === 'string'
              ? candidate.blob_id
              : undefined,
          size: candidate.size as number | string | undefined,
        };
      }

      for (const value of Object.values(current as Record<string, unknown>)) {
        if (value && typeof value === 'object') {
          queue.push(value);
        }
      }
    }

    return null;
  }

  async downloadFile(blobId: string, contextId: string): Promise<Blob> {
    const contextIdCandidates = buildContextIdCandidates(contextId);

    for (let index = 0; index < contextIdCandidates.length; index += 1) {
      const candidate = contextIdCandidates[index];
      const url = `${getNodeEndpoint()}/admin-api/blobs/${blobId}?context_id=${encodeURIComponent(candidate)}`;
      const response = await fetch(url, {
        headers: getAdminHeaders(),
      });

      if (response.ok) {
        return response.blob();
      }

      const canRetryWithNext =
        response.status === 400 && index < contextIdCandidates.length - 1;
      if (!canRetryWithNext) {
        throw new Error(
          `Download failed: ${response.status} ${response.statusText}`,
        );
      }
    }

    throw new Error('Download failed: could not resolve context ID format.');
  }

  triggerBrowserDownload(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}
