import { useState, useCallback, useRef } from "react";
import {
  getAppEndpointKey,
  getAccessToken,
} from "@calimero-network/calimero-client";
import * as api from "../api/kvStore";
import { useAutoRefresh } from "../hooks/useAutoRefresh";
import { SyncBar } from "../components/SyncBar";

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

async function uploadBlobToNode(file: File): Promise<string> {
  const nodeUrl = getAppEndpointKey();
  const token = getAccessToken();
  if (!nodeUrl) throw new Error("Node URL not set");

  const form = new FormData();
  form.append("file", file);

  const res = await fetch(`${nodeUrl}/blobs`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Blob upload failed (${res.status}): ${text}`);
  }

  const body = await res.json() as { data?: { blobId?: string; blob_id?: string } };
  const blobId = body?.data?.blobId ?? body?.data?.blob_id;
  if (!blobId) throw new Error(`No blobId in response: ${JSON.stringify(body)}`);
  return blobId;
}

async function downloadBlob(blobIdB58: string, filename: string, mimeType: string) {
  const nodeUrl = getAppEndpointKey();
  const token = getAccessToken();
  if (!nodeUrl) throw new Error("Node URL not set");

  const res = await fetch(`${nodeUrl}/blobs/${blobIdB58}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

  if (!res.ok) throw new Error(`Download failed (${res.status}): ${res.statusText}`);

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function FileShareDemo() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [registeredFileId, setRegisteredFileId] = useState<string | null>(null);
  const [liveFiles, setLiveFiles] = useState<api.FileRecord[]>([]);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const poll = useCallback(async () => {
    const res = await api.listFiles();
    const files = (res as { result?: { output?: api.FileRecord[] } })?.result?.output;
    if (files !== undefined) setLiveFiles(files);
  }, []);

  const { pulse, sinceLabel } = useAutoRefresh(poll, 4000);

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setSelectedFile(f);
    setUploadStatus(null);
    setRegisteredFileId(null);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (!f) return;
    setSelectedFile(f);
    setUploadStatus(null);
    setRegisteredFileId(null);
  }

  async function handleUpload() {
    if (!selectedFile) return;
    setUploading(true);
    setUploadStatus(null);
    setRegisteredFileId(null);

    try {
      const blobId = await uploadBlobToNode(selectedFile);
      const res = await api.uploadFile(
        selectedFile.name,
        blobId,
        selectedFile.size,
        selectedFile.type || "application/octet-stream",
      );
      const fileId = (res as { result?: { output?: string } })?.result?.output;
      if (fileId) {
        setRegisteredFileId(fileId);
        setUploadStatus({ type: "success", message: `Registered as file_id: ${fileId}` });
      } else {
        setUploadStatus({ type: "success", message: "File uploaded and registered." });
      }
      poll();
    } catch (err) {
      setUploadStatus({ type: "error", message: String(err) });
    } finally {
      setUploading(false);
    }
  }

  async function handleDownload(file: api.FileRecord) {
    setDownloadingId(file.id);
    try {
      const blobRes = await api.getBlobIdB58(file.id);
      const blobId = (blobRes as { result?: { output?: string } })?.result?.output;
      if (!blobId) throw new Error("Could not get blob ID");
      await downloadBlob(blobId, file.name, file.mime_type);
    } catch (err) {
      alert(`Download failed: ${String(err)}`);
    } finally {
      setDownloadingId(null);
    }
  }

  return (
    <div>
      <div className="section-header">
        <h2 className="section-title">File Share Demo</h2>
        <p className="section-desc">
          Upload a file from this node and watch its metadata replicate to every other node in the
          context via CRDT. Any node can then download the blob from its own local store.
        </p>
      </div>

      <div
        style={{
          background: "rgba(165,255,17,0.06)",
          border: "1px solid rgba(165,255,17,0.2)",
          borderRadius: 8,
          padding: "12px 16px",
          marginBottom: 20,
          fontSize: 13,
          color: "var(--color-text-muted)",
          lineHeight: 1.6,
        }}
      >
        <strong style={{ color: "var(--color-brand-600)" }}>How it works:</strong>{" "}
        Upload on Node A → metadata syncs to Node B via CRDT → Node B downloads from its own blob store
      </div>

      <div className="method-card" style={{ marginBottom: 20 }}>
        <div className="method-name">Upload &amp; Share</div>

        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          style={{
            border: `2px dashed ${dragOver ? "var(--color-brand-600)" : "var(--color-border)"}`,
            borderRadius: 8,
            padding: "24px 16px",
            textAlign: "center",
            cursor: "pointer",
            color: "var(--color-text-muted)",
            fontSize: 13,
            transition: "border-color 0.2s",
            marginBottom: 12,
          }}
          onMouseEnter={(e) => (e.currentTarget.style.borderColor = "var(--color-brand-600)")}
          onMouseLeave={(e) => {
            if (!dragOver) e.currentTarget.style.borderColor = "var(--color-border)";
          }}
        >
          <input
            ref={fileInputRef}
            type="file"
            style={{ display: "none" }}
            onChange={handleFileSelect}
          />
          {selectedFile ? (
            <span>
              <strong style={{ color: "var(--color-text-primary)" }}>{selectedFile.name}</strong>
              {"  "}
              <span style={{ fontSize: 12 }}>
                ({formatBytes(selectedFile.size)},{" "}
                {selectedFile.type || "application/octet-stream"})
              </span>
            </span>
          ) : (
            "Drop a file here or click to select"
          )}
        </div>

        {uploadStatus && (
          <div
            style={{
              fontSize: 12,
              color: uploadStatus.type === "success" ? "var(--color-success)" : "var(--color-error)",
              marginBottom: 10,
              wordBreak: "break-all",
            }}
          >
            {uploadStatus.message}
          </div>
        )}

        {registeredFileId && (
          <div style={{ fontSize: 12, color: "var(--color-text-muted)", marginBottom: 10 }}>
            file_id:{" "}
            <code style={{ fontSize: 11 }}>{registeredFileId}</code>
          </div>
        )}

        <button
          className="btn-calimero"
          disabled={uploading || !selectedFile}
          onClick={handleUpload}
        >
          {uploading ? "Uploading…" : "Upload & Share"}
        </button>
      </div>

      <div className="method-card" style={{ marginBottom: 20 }}>
        <SyncBar pulse={pulse} sinceLabel={sinceLabel} onRefresh={poll} />
        <div className="method-name">Shared files</div>

        {liveFiles.length === 0 ? (
          <p style={{ fontSize: 12, color: "var(--color-text-muted)", margin: 0 }}>
            No files registered yet. Upload one above.
          </p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {["Name", "Size", "MIME", "File ID", ""].map((h) => (
                  <th
                    key={h}
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: "var(--color-text-muted)",
                      textAlign: "left",
                      padding: "6px 8px",
                      borderBottom: "1px solid var(--color-border)",
                      textTransform: "uppercase",
                      letterSpacing: "0.4px",
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {liveFiles.map((f) => (
                <tr key={f.id} style={{ borderBottom: "1px solid var(--color-border)" }}>
                  <td style={{ padding: "8px", fontSize: 13 }}>{f.name}</td>
                  <td style={{ padding: "8px", fontSize: 12, color: "var(--color-text-muted)" }}>
                    {formatBytes(f.size)}
                  </td>
                  <td style={{ padding: "8px", fontSize: 12, color: "var(--color-text-muted)" }}>
                    {f.mime_type}
                  </td>
                  <td style={{ padding: "8px" }}>
                    <code style={{ fontSize: 10 }}>{f.id.slice(0, 16)}…</code>
                  </td>
                  <td style={{ padding: "8px" }}>
                    <button
                      className="btn-calimero-outline"
                      style={{ fontSize: 11, padding: "3px 10px" }}
                      disabled={downloadingId === f.id}
                      onClick={() => handleDownload(f)}
                    >
                      {downloadingId === f.id ? "…" : "Download"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div
        style={{
          background: "var(--color-bg-card)",
          border: "1px solid var(--color-border)",
          borderRadius: 8,
          padding: "12px 16px",
          fontSize: 12,
          color: "var(--color-text-muted)",
          lineHeight: 1.6,
        }}
      >
        Open a second tab with{" "}
        <code>?node=http://localhost:2529</code> to see this file appear and download
        it from Node B's blob store.
      </div>
    </div>
  );
}
