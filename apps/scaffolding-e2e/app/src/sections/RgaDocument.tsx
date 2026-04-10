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

export function RgaDocument() {
  const [insertPos, setInsertPos] = useState("0");
  const [insertText, setInsertText] = useState("");
  const [deleteStart, setDeleteStart] = useState("0");
  const [deleteEnd, setDeleteEnd] = useState("0");
  const [appendText, setAppendText] = useState("");
  const [title, setTitle] = useState("");

  const insertCall = useCall();
  const deleteCall = useCall();
  const appendCall = useCall();
  const setTitleCall = useCall();
  const getTitleCall = useCall();
  const getTextCall = useCall();
  const getLenCall = useCall();
  const isEmptyCall = useCall();
  const clearCall = useCall();

  return (
    <div>
      <div className="section-header">
        <h2 className="section-title">RGA Document</h2>
        <p className="section-desc">
          Replicated Growable Array (RGA) for collaborative text editing.
          Concurrent insertions/deletions are merged automatically across nodes.
        </p>
      </div>

      <div className="method-grid">
        <div className="method-card">
          <div className="method-name">rga_insert_text(position, text)</div>
          <div className="method-inputs">
            <input
              className="form-control"
              placeholder="position"
              type="number"
              min="0"
              value={insertPos}
              onChange={(e) => setInsertPos(e.target.value)}
            />
            <input
              className="form-control"
              placeholder="text to insert"
              value={insertText}
              onChange={(e) => setInsertText(e.target.value)}
            />
          </div>
          <button
            className="btn-calimero"
            disabled={insertCall.loading}
            onClick={() =>
              insertCall.run(() =>
                api.rgaInsertText(parseInt(insertPos, 10), insertText),
              )
            }
          >
            {insertCall.loading ? "..." : "Execute"}
          </button>
          <ResultBox result={insertCall.result} />
        </div>

        <div className="method-card">
          <div className="method-name">rga_delete_text(start, end)</div>
          <div className="method-inputs">
            <div className="input-row">
              <input
                className="form-control"
                placeholder="start"
                type="number"
                min="0"
                value={deleteStart}
                onChange={(e) => setDeleteStart(e.target.value)}
              />
              <input
                className="form-control"
                placeholder="end"
                type="number"
                min="0"
                value={deleteEnd}
                onChange={(e) => setDeleteEnd(e.target.value)}
              />
            </div>
          </div>
          <button
            className="btn-danger-outline"
            disabled={deleteCall.loading}
            onClick={() =>
              deleteCall.run(() =>
                api.rgaDeleteText(
                  parseInt(deleteStart, 10),
                  parseInt(deleteEnd, 10),
                ),
              )
            }
          >
            {deleteCall.loading ? "..." : "Execute"}
          </button>
          <ResultBox result={deleteCall.result} />
        </div>

        <div className="method-card">
          <div className="method-name">rga_append_text(text)</div>
          <div className="method-inputs">
            <input
              className="form-control"
              placeholder="text to append"
              value={appendText}
              onChange={(e) => setAppendText(e.target.value)}
            />
          </div>
          <button
            className="btn-calimero"
            disabled={appendCall.loading}
            onClick={() =>
              appendCall.run(() => api.rgaAppendText(appendText))
            }
          >
            {appendCall.loading ? "..." : "Execute"}
          </button>
          <ResultBox result={appendCall.result} />
        </div>

        <div className="method-card">
          <div className="method-name">
            rga_set_title / rga_get_title
          </div>
          <div className="method-inputs">
            <input
              className="form-control"
              placeholder="new title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div className="input-row">
            <button
              className="btn-calimero"
              disabled={setTitleCall.loading}
              onClick={() =>
                setTitleCall.run(() => api.rgaSetTitle(title))
              }
            >
              {setTitleCall.loading ? "..." : "set_title"}
            </button>
            <button
              className="btn-calimero-outline"
              disabled={getTitleCall.loading}
              onClick={() => getTitleCall.run(() => api.rgaGetTitle())}
            >
              {getTitleCall.loading ? "..." : "get_title"}
            </button>
          </div>
          <ResultBox result={setTitleCall.result} />
          <ResultBox result={getTitleCall.result} />
        </div>

        <div className="method-card">
          <div className="method-name">
            rga_get_text / rga_get_length / rga_is_empty
          </div>
          <div className="input-row" style={{ marginBottom: 0 }}>
            <button
              className="btn-calimero-outline"
              disabled={getTextCall.loading}
              onClick={() => getTextCall.run(() => api.rgaGetText())}
            >
              {getTextCall.loading ? "..." : "get_text"}
            </button>
            <button
              className="btn-calimero-outline"
              disabled={getLenCall.loading}
              onClick={() => getLenCall.run(() => api.rgaGetLength())}
            >
              {getLenCall.loading ? "..." : "length"}
            </button>
            <button
              className="btn-calimero-outline"
              disabled={isEmptyCall.loading}
              onClick={() => isEmptyCall.run(() => api.rgaIsEmpty())}
            >
              {isEmptyCall.loading ? "..." : "is_empty"}
            </button>
          </div>
          <ResultBox result={getTextCall.result} />
          <ResultBox result={getLenCall.result} />
          <ResultBox result={isEmptyCall.result} />
        </div>

        <div className="method-card">
          <div className="method-name">rga_clear()</div>
          <p
            style={{
              fontSize: 12,
              color: "var(--color-text-muted)",
              marginBottom: 10,
            }}
          >
            Clears all text from the document.
          </p>
          <button
            className="btn-danger-outline"
            disabled={clearCall.loading}
            onClick={() => clearCall.run(() => api.rgaClear())}
          >
            {clearCall.loading ? "..." : "Execute"}
          </button>
          <ResultBox result={clearCall.result} />
        </div>
      </div>
    </div>
  );
}
