import { useState, useCallback, useRef } from "react";
import { ResultBox } from "../components/ResultBox";
import { getNodeUrl } from "../lib/mero";
import * as api from "../api/kvStore";
import { useAutoRefresh } from "../hooks/useAutoRefresh";
import { SyncBar } from "../components/SyncBar";
import { formatBytes, uploadBlobToNode, downloadBlobFrom } from "../utils/blobUtils";


function useCall() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<unknown>(undefined);
  async function run(fn: () => Promise<unknown>) {
    setLoading(true);
    try {
      setResult(await fn());
    } catch (e) {
      setResult({ error: String(e) });
    } finally {
      setLoading(false);
    }
  }
  return { loading, result, run };
}

export function BlobStorage() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState<{ text: string; ok: boolean } | null>(null);
  const [fileId, setFileId] = useState("");
  const [deleteId, setDeleteId] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [liveFiles, setLiveFiles] = useState<api.FileRecord[]>([]);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<{ id: string; msg: string } | null>(null);

  const uploadCall = useCall();
  const deleteCall = useCall();
  const getCall = useCall();
  const getBlobCall = useCall();
  const searchCall = useCall();

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
    setUploadProgress(null);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (!f) return;
    setSelectedFile(f);
    setUploadProgress(null);
  }

  async function handleUpload() {
    if (!selectedFile) return;
    setUploadProgress({ text: "Uploading to node blob store…", ok: true });
    let blobId: string;
    try {
      blobId = await uploadBlobToNode(selectedFile);
    } catch (err) {
      setUploadProgress({ text: String(err), ok: false });
      return;
    }

    uploadCall.run(async () => {
      const res = await api.uploadFile(
        selectedFile.name,
        blobId,
        selectedFile.size,
        selectedFile.type || "application/octet-stream",
      );
      const fid = (res as { result?: { output?: string } })?.result?.output;
      if (fid) {
        const nodeUrl = getNodeUrl();
        if (nodeUrl) await api.setMetadata("_blob_nodes", fid, nodeUrl);
        setFileId(fid);
        setUploadProgress({ text: `Registered — file_id: ${fid.slice(0, 20)}…`, ok: true });
      }
      poll();
      return res;
    });
  }

  function handleCopyId(id: string) {
    navigator.clipboard.writeText(id).then(() => {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1500);
    });
  }

  async function handleDownload(file: api.FileRecord) {
    setDownloadingId(file.id);
    setDownloadError(null);
    try {
      const blobRes = await api.getBlobIdB58(file.id);
      const blobId = (blobRes as { result?: { output?: string } })?.result?.output;
      if (!blobId) throw new Error("Could not get blob ID");
      const nodeUrl = getNodeUrl();
      if (!nodeUrl) throw new Error("Node URL not set");
      await downloadBlobFrom(nodeUrl, blobId, file.name, file.mime_type);
    } catch (err) {
      setDownloadError({ id: file.id, msg: String(err) });
    } finally {
      setDownloadingId(null);
    }
  }

  return (
    <div>
      <div className="section-header">
        <h2 className="section-title">Blob Storage</h2>
        <p className="section-desc">
          Upload files to the node's blob store, register their metadata to the context,
          and share them between nodes.
        </p>
      </div>

      <div style={{ background: "rgba(165,255,17,0.06)", border: "1px solid rgba(165,255,17,0.2)", borderRadius: 8, padding: "12px 16px", marginBottom: 20, fontSize: 13, color: "var(--color-text-muted)", lineHeight: 1.6 }}>
        <strong style={{ color: "var(--color-brand-600)" }}>Cross-node sharing:</strong>{" "}
        Upload on Node A → file metadata syncs to Node B via CRDT → Node B can download the blob from its own store.
        Open a second tab with <code>?node=http://localhost:2529</code> to see this in action.
      </div>

      {/* Live file list */}
      <div className="method-card" style={{ marginBottom: 16 }}>
        <SyncBar pulse={pulse} sinceLabel={sinceLabel} onRefresh={poll} />
        <div className="method-name">Shared files — live view</div>
        {liveFiles.length === 0 ? (
          <p style={{ fontSize: 12, color: "var(--color-text-muted)", margin: 0 }}>
            No files uploaded yet.
          </p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 8 }}>
            <thead>
              <tr>
                {["Name", "Size", "Type", "File ID", ""].map((h) => (
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
                    <code
                      title={f.id}
                      onClick={() => handleCopyId(f.id)}
                      style={{
                        fontSize: 10,
                        cursor: "pointer",
                        opacity: copiedId === f.id ? 0.6 : 1,
                        transition: "opacity 0.15s",
                      }}
                    >
                      {copiedId === f.id ? "copied!" : `${f.id.slice(0, 16)}…`}
                    </code>
                  </td>
                  <td style={{ padding: "8px" }}>
                    <button
                      className="btn-calimero-outline"
                      style={{ fontSize: 11, padding: "3px 10px" }}
                      disabled={downloadingId === f.id}
                      onClick={() => handleDownload(f)}
                    >
                      {downloadingId === f.id ? <span className="spinner" /> : "Download"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {downloadError && (
          <div
            style={{
              marginTop: 12,
              padding: "10px 14px",
              background: "rgba(239,68,68,0.08)",
              border: "1px solid rgba(239,68,68,0.3)",
              borderRadius: 6,
              fontSize: 12,
              color: "var(--color-error)",
              lineHeight: 1.5,
            }}
          >
            <strong>Download failed</strong>{" — "}{downloadError.msg}
          </div>
        )}
      </div>

      <div className="method-grid">
        {/* Upload card */}
        <div className="method-card">
          <div className="method-name">upload_file</div>

          {/* Drop zone */}
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            style={{
              border: "2px dashed var(--color-border)",
              borderRadius: 8,
              padding: "20px 16px",
              textAlign: "center",
              cursor: "pointer",
              color: "var(--color-text-muted)",
              fontSize: 13,
              transition: "border-color 0.2s",
              marginBottom: 12,
            }}
            onMouseEnter={(e) => (e.currentTarget.style.borderColor = "var(--color-brand-600)")}
            onMouseLeave={(e) => (e.currentTarget.style.borderColor = "var(--color-border)")}
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
                <span style={{ fontSize: 12 }}>({formatBytes(selectedFile.size)}, {selectedFile.type || "unknown type"})</span>
              </span>
            ) : (
              "Drop a file here or click to select"
            )}
          </div>

          {uploadProgress && (
            <div style={{ fontSize: 12, color: uploadProgress.ok ? "var(--color-text-muted)" : "var(--color-error)", marginBottom: 10 }}>
              {uploadProgress.text}
            </div>
          )}

          <button
            className="btn-calimero"
            disabled={uploadCall.loading || !selectedFile}
            onClick={handleUpload}
          >
            {uploadCall.loading ? "Uploading…" : "Upload & Register"}
          </button>
          <ResultBox result={uploadCall.result} />
        </div>

        {/* Search card */}
        <div className="method-card">
          <div className="method-name">search_files(query)</div>
          <div className="method-inputs">
            <input
              className="form-control"
              placeholder="search query (matches file name)"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <button
            className="btn-calimero-outline"
            onClick={() => searchCall.run(() => api.searchFiles(searchQuery))}
          >
            Search
          </button>
          <ResultBox result={searchCall.result} />
        </div>

        {/* Get by ID card */}
        <div className="method-card">
          <div className="method-name">get_file(file_id) / get_blob_id_hex(file_id)</div>
          <div className="method-inputs">
            <input
              className="form-control"
              placeholder="file_id"
              value={fileId}
              onChange={(e) => setFileId(e.target.value)}
            />
          </div>
          <div className="input-row">
            <button
              className="btn-calimero-outline"
              disabled={getCall.loading}
              onClick={() => getCall.run(() => api.getFile(fileId))}
            >
              {getCall.loading ? "..." : "get_file"}
            </button>
            <button
              className="btn-calimero-outline"
              disabled={getBlobCall.loading}
              onClick={() => getBlobCall.run(() => api.getBlobIdB58(fileId))}
            >
              {getBlobCall.loading ? "..." : "get_blob_id"}
            </button>
          </div>
          <ResultBox result={getCall.result} />
          <ResultBox result={getBlobCall.result} />
        </div>

        {/* Delete card */}
        <div className="method-card">
          <div className="method-name">delete_file(file_id)</div>
          <div className="method-inputs">
            <input
              className="form-control"
              placeholder="file_id"
              value={deleteId}
              onChange={(e) => setDeleteId(e.target.value)}
            />
          </div>
          <button
            className="btn-danger-outline"
            disabled={deleteCall.loading}
            onClick={() => deleteCall.run(async () => { const r = await api.deleteFile(deleteId); poll(); return r; })}
          >
            {deleteCall.loading ? "..." : "Execute"}
          </button>
          <ResultBox result={deleteCall.result} />
        </div>
      </div>
    </div>
  );
}
