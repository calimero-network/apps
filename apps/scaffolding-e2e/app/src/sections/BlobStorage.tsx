import { useState } from "react";
import * as api from "../api/kvStore";

function ResultBox({ result }: { result: unknown }) {
  if (result === undefined) return null;
  const isError =
    result !== null &&
    typeof result === "object" &&
    "error" in result &&
    (result as { error: unknown }).error !== null;
  return (
    <pre className={`result-box${isError ? " error" : ""}`}>
      {JSON.stringify(result, null, 2)}
    </pre>
  );
}

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
  const [uploadName, setUploadName] = useState("");
  const [blobId, setBlobId] = useState("");
  const [size, setSize] = useState("0");
  const [mimeType, setMimeType] = useState("application/octet-stream");

  const [fileId, setFileId] = useState("");
  const [deleteId, setDeleteId] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  const uploadCall = useCall();
  const deleteCall = useCall();
  const listCall = useCall();
  const getCall = useCall();
  const getBlobCall = useCall();
  const searchCall = useCall();

  function handleUpload() {
    uploadCall.run(async () => {
      const res = await api.uploadFile(
        uploadName,
        blobId,
        parseInt(size, 10),
        mimeType,
      );
      if (res.result?.output) setFileId(res.result.output);
      return res;
    });
  }

  return (
    <div>
      <div className="section-header">
        <h2 className="section-title">Blob Storage</h2>
        <p className="section-desc">
          File metadata storage and blob announcement to peers. The blob itself
          is identified by its base58 ID.
        </p>
      </div>

      <div className="method-grid">
        <div className="method-card">
          <div className="method-name">
            upload_file(name, blob_id, size, mime_type) → file_id
          </div>
          <div className="method-inputs">
            <input
              className="form-control"
              placeholder="name"
              value={uploadName}
              onChange={(e) => setUploadName(e.target.value)}
            />
            <input
              className="form-control"
              placeholder="blob_id (base58)"
              value={blobId}
              onChange={(e) => setBlobId(e.target.value)}
            />
            <div className="input-row">
              <input
                className="form-control"
                placeholder="size (bytes)"
                type="number"
                value={size}
                onChange={(e) => setSize(e.target.value)}
              />
              <input
                className="form-control"
                placeholder="mime type"
                value={mimeType}
                onChange={(e) => setMimeType(e.target.value)}
              />
            </div>
          </div>
          <button
            className="btn-calimero"
            disabled={uploadCall.loading}
            onClick={handleUpload}
          >
            {uploadCall.loading ? "..." : "Execute"}
          </button>
          <ResultBox result={uploadCall.result} />
        </div>

        <div className="method-card">
          <div className="method-name">list_files()</div>
          <button
            className="btn-calimero-outline"
            disabled={listCall.loading}
            onClick={() => listCall.run(() => api.listFiles())}
          >
            {listCall.loading ? "..." : "Execute"}
          </button>
          <ResultBox result={listCall.result} />
        </div>

        <div className="method-card">
          <div className="method-name">
            get_file(file_id) / get_blob_id_b58(file_id)
          </div>
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

        <div className="method-card">
          <div className="method-name">search_files(query)</div>
          <div className="method-inputs">
            <input
              className="form-control"
              placeholder="search query"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <button
            className="btn-calimero-outline"
            disabled={searchCall.loading}
            onClick={() => searchCall.run(() => api.searchFiles(searchQuery))}
          >
            {searchCall.loading ? "..." : "Execute"}
          </button>
          <ResultBox result={searchCall.result} />
        </div>

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
            onClick={() => deleteCall.run(() => api.deleteFile(deleteId))}
          >
            {deleteCall.loading ? "..." : "Execute"}
          </button>
          <ResultBox result={deleteCall.result} />
        </div>
      </div>
    </div>
  );
}
