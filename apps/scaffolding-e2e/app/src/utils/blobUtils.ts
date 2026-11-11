import { describeError } from "@calimero-apps/connect";

import { getConnection } from "../lib/calimero";

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

// A blob belongs to an app instance on 1.0: `client.uploadBlob(app, bytes)`
// stores it in the open instance's blob store, which every node of the cluster
// serves, so there is no announce and no peer discovery (v1's `context_id`
// query parameter). The contract keeps the record (`upload_file`) with the
// blob's id; it cannot read the bytes itself at core 1.0.0-rc.7.

/** Uploads `file` to the open instance's blob store and returns its id (64 hex). */
export async function uploadBlobToNode(file: File): Promise<string> {
  const conn = getConnection();
  if (!conn) throw new Error("No app instance open");
  try {
    const { blobId } = await conn.client.apps.blobUpload({
      app: conn.appId,
      body: new Uint8Array(await file.arrayBuffer()),
      contentType: "application/octet-stream",
    });
    if (!blobId) throw new Error("No blobId in the upload's answer");
    return blobId;
  } catch (err) {
    throw new Error(`Blob upload failed: ${describeError(err)}`);
  } finally {
    conn.after();
  }
}

/** Downloads blob `blobId` of the open instance and saves it as `filename`. */
export async function downloadBlobFrom(_nodeUrl: string, blobId: string, filename: string, mimeType: string) {
  const conn = getConnection();
  if (!conn) throw new Error("No app instance open");
  let bytes: Uint8Array;
  try {
    bytes = await conn.client.downloadBlob(conn.appId, blobId);
  } catch (err) {
    throw new Error(`Download failed: ${describeError(err)}`);
  } finally {
    conn.after();
  }
  const blob = new Blob([bytes as BlobPart], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
