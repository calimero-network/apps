import { HTTPError } from "@calimero-network/mero-js";
import { getContextId, getMeroClient, NODE_REQUEST_TIMEOUT_MS } from "../lib/mero";
import { notifyUnauthorized } from "../api/adminApi";

// The client's per-request budget is sized for blob discovery — see
// NODE_REQUEST_TIMEOUT_MS in lib/mero.ts. (Read inside the functions, not at
// module level: ConnectScreen.test mocks lib/mero with a fixed export list.)

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

// Both calls go through mero-js's `admin.uploadBlob` / `admin.getBlob` rather
// than a hand-written `fetch` to `/admin-api/blobs`. The SDK does what the
// hand-written version had to learn the hard way: it streams the raw bytes
// (`PUT /admin-api/blobs` does not parse multipart — a FormData body stored
// the MIME boundary and headers as part of the blob), and it sends the
// `context_id` query param from `contextId`, which is what makes the node
// announce the upload and probe the context's peers on a read.

export async function uploadBlobToNode(file: File): Promise<string> {
  const client = getMeroClient();
  if (!client) throw new Error("Node URL not set");

  // Without `contextId` nothing is announced, so no availability node ever
  // prefetches this blob and cold reads on other nodes have nothing to find.
  const contextId = getContextId() || undefined;
  const data = await file.arrayBuffer();

  let payload: { blobId?: string; blob_id?: string };
  try {
    payload = await client.admin.uploadBlob({ data, contextId });
  } catch (err) {
    if (err instanceof HTTPError) {
      if (err.status === 401) { notifyUnauthorized(); throw new Error("Unauthorized"); }
      const text = err.explanation ?? err.bodyText?.trim() ?? "";
      throw new Error(`Blob upload failed (${err.status}${text ? `: ${text}` : ` ${err.statusText || "no message"}`})`);
    }
    throw err;
  }

  const blobId = payload?.blobId ?? payload?.blob_id;
  if (!blobId) throw new Error(`No blobId in response: ${JSON.stringify(payload)}`);
  return blobId;
}

export async function downloadBlobFrom(_nodeUrl: string, blobId: string, filename: string, mimeType: string) {
  const client = getMeroClient();
  if (!client) throw new Error("Node URL not set");
  // No context, no discovery: the node checks its own store and 404s. This is
  // the difference between "a file a peer uploaded downloads" and "it doesn't".
  const contextId = getContextId() || undefined;

  let bytes: ArrayBuffer;
  try {
    bytes = await client.admin.getBlob(blobId, { contextId });
  } catch (err) {
    if (err instanceof HTTPError) {
      if (err.status === 401) { notifyUnauthorized(); throw new Error("Unauthorized"); }
      if (err.status === 0 && /abort|timed? ?out/i.test(err.explanation ?? "")) {
        throw new Error(
          `Download timed out after ${NODE_REQUEST_TIMEOUT_MS / 1000}s. The node could not find this blob ` +
          `on any peer in this context.`,
        );
      }
      const text = err.explanation ?? err.bodyText?.trim() ?? "";
      throw new Error(`Download failed (${err.status}): ${text || err.statusText}`);
    }
    if (err instanceof DOMException && err.name === "TimeoutError") {
      throw new Error(
        `Download timed out after ${NODE_REQUEST_TIMEOUT_MS / 1000}s. The node could not find this blob ` +
        `on any peer in this context.`,
      );
    }
    throw err;
  }

  const blob = new Blob([bytes], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
