import { getAccessToken, getContextId, getNodeUrl } from "../lib/mero";
import { notifyUnauthorized } from "../api/adminApi";

/**
 * Core's blob discovery sweep runs to a **30 s deadline before the transfer
 * starts** (probe-based discovery, rc.39 / core#3831). A client budget under
 * that cancels a fetch that was about to succeed and reports it as a failure —
 * and it cancels it in precisely the case discovery exists for: a blob held by
 * a peer and not by us. No budget at all is not the answer either; a stalled
 * node should fail, just not before core has finished looking.
 */
const BLOB_READ_TIMEOUT_MS = 35_000;

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export async function uploadBlobToNode(file: File): Promise<string> {
  const nodeUrl = getNodeUrl();
  const token = getAccessToken();
  if (!nodeUrl) throw new Error("Node URL not set");

  // `PUT /admin-api/blobs` streams the request body **straight into blob
  // storage**. It does not parse multipart. Sending a FormData therefore stored
  // the MIME boundary, the Content-Disposition header, the bytes, and the
  // closing boundary — and because upload and download were symmetric the demo
  // round-tripped and looked correct, while every byte the user downloaded was
  // wrong and no other tool could open the file.
  const body = await file.arrayBuffer();

  // Without `context_id` nothing is announced, so no availability node ever
  // prefetches this blob and cold reads on other nodes have nothing to find.
  const contextId = getContextId();
  const qs = contextId ? `?context_id=${encodeURIComponent(contextId)}` : "";

  const res = await fetch(`${nodeUrl}/admin-api/blobs${qs}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/octet-stream",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body,
  });

  if (res.status === 401) { notifyUnauthorized(); throw new Error("Unauthorized"); }

  if (!res.ok) {
    const text = (await res.text().catch(() => "")).trim();
    throw new Error(`Blob upload failed (${res.status}${text ? `: ${text}` : ` ${res.statusText || "no message"}`})`);
  }

  const payload = await res.json() as { data?: { blobId?: string; blob_id?: string } };
  const blobId = payload?.data?.blobId ?? payload?.data?.blob_id;
  if (!blobId) throw new Error(`No blobId in response: ${JSON.stringify(payload)}`);
  return blobId;
}

export async function downloadBlobFrom(nodeUrl: string, blobId: string, filename: string, mimeType: string) {
  const token = getAccessToken();
  const contextId = getContextId();
  // No context, no discovery: the node checks its own store and 404s. This is
  // the difference between "a file a peer uploaded downloads" and "it doesn't".
  const qs = contextId ? `?context_id=${encodeURIComponent(contextId)}` : "";

  let res: Response;
  try {
    res = await fetch(`${nodeUrl}/admin-api/blobs/${blobId}${qs}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      signal: AbortSignal.timeout(BLOB_READ_TIMEOUT_MS),
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "TimeoutError") {
      throw new Error(
        `Download timed out after ${BLOB_READ_TIMEOUT_MS / 1000}s. The node could not find this blob ` +
        `on any peer in this context.`,
      );
    }
    throw err;
  }

  if (res.status === 401) { notifyUnauthorized(); throw new Error("Unauthorized"); }
  if (!res.ok) {
    const text = (await res.text().catch(() => "")).trim();
    throw new Error(`Download failed (${res.status}): ${text || res.statusText}`);
  }
  const blob = new Blob([await res.arrayBuffer()], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
