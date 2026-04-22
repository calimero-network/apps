import {
  getAppEndpointKey,
  getAccessToken,
  getContextId,
} from "@calimero-network/calimero-client";
import { notifyUnauthorized } from "../api/adminApi";

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export async function uploadBlobToNode(file: File): Promise<string> {
  const nodeUrl = getAppEndpointKey();
  const token = getAccessToken();
  if (!nodeUrl) throw new Error("Node URL not set");

  const form = new FormData();
  form.append("file", file);

  const res = await fetch(`${nodeUrl}/admin-api/blobs`, {
    method: "PUT",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });

  if (res.status === 401) { notifyUnauthorized(); throw new Error("Unauthorized"); }

  if (!res.ok) {
    const text = (await res.text().catch(() => "")).trim();
    throw new Error(`Blob upload failed (${res.status}${text ? `: ${text}` : ` ${res.statusText || "no message"}`})`);
  }

  const body = await res.json() as { data?: { blobId?: string; blob_id?: string } };
  const blobId = body?.data?.blobId ?? body?.data?.blob_id;
  if (!blobId) throw new Error(`No blobId in response: ${JSON.stringify(body)}`);
  return blobId;
}

export async function downloadBlobFrom(nodeUrl: string, blobIdB58: string, filename: string, mimeType: string) {
  const token = getAccessToken();
  const contextId = getContextId();
  const qs = contextId ? `?context_id=${contextId}` : "";
  const res = await fetch(`${nodeUrl}/admin-api/blobs/${blobIdB58}${qs}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (res.status === 401) { notifyUnauthorized(); throw new Error("Unauthorized"); }
  if (!res.ok) {
    const text = (await res.text().catch(() => "")).trim();
    throw new Error(`Download failed (${res.status}): ${text || res.statusText}`);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
