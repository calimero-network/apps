import { useState, useCallback } from "react";
import { ResultBox } from "../components/ResultBox";
import * as api from "../api/kvStore";
import { useAutoRefresh } from "../hooks/useAutoRefresh";
import { SyncBar } from "../components/SyncBar";


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

  const [liveText, setLiveText] = useState<string | null>(null);
  const [liveTitle, setLiveTitle] = useState<string | null>(null);

  const insertCall = useCall();
  const deleteCall = useCall();
  const appendCall = useCall();
  const setTitleCall = useCall();
  const clearCall = useCall();

  const poll = useCallback(async () => {
    const [textRes, titleRes] = await Promise.all([api.rgaGetText(), api.rgaGetTitle()]);
    const text = (textRes as { result?: { output?: string } })?.result?.output;
    const t = (titleRes as { result?: { output?: string } })?.result?.output;
    if (text !== undefined) setLiveText(text);
    if (t !== undefined) setLiveTitle(t);
  }, []);

  const { pulse, sinceLabel } = useAutoRefresh(poll, 2000);

  return (
    <div>
      <div className="section-header">
        <h2 className="section-title">RGA Document</h2>
        <p className="section-desc">
          Replicated Growable Array (RGA) for collaborative text editing.
          Concurrent insertions/deletions merge automatically across nodes. The live
          preview below updates every 2 s — edit on Node A and watch Node B's view change.
        </p>
      </div>

      {/* Live document preview */}
      <div className="method-card" style={{ marginBottom: 16 }}>
        <SyncBar pulse={pulse} sinceLabel={sinceLabel} onRefresh={poll} />
        <div className="method-name">Document — live preview</div>
        {liveTitle !== null && (
          <div style={{ fontSize: 12, color: "var(--color-text-muted)", marginBottom: 6 }}>
            title: <strong style={{ color: "var(--color-text-primary)" }}>{liveTitle || "(empty)"}</strong>
          </div>
        )}
        <pre className="result-box" style={{ margin: 0, minHeight: 60, whiteSpace: "pre-wrap" }}>
          {liveText === null ? "Loading…" : liveText || "(empty document)"}
        </pre>
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
              insertCall.run(async () => {
                const r = await api.rgaInsertText(parseInt(insertPos, 10), insertText);
                poll();
                return r;
              })
            }
          >
            {insertCall.loading ? "..." : "Execute"}
          </button>
          <ResultBox result={insertCall.result} />
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
              appendCall.run(async () => {
                const r = await api.rgaAppendText(appendText);
                poll();
                return r;
              })
            }
          >
            {appendCall.loading ? "..." : "Execute"}
          </button>
          <ResultBox result={appendCall.result} />
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
              deleteCall.run(async () => {
                const r = await api.rgaDeleteText(parseInt(deleteStart, 10), parseInt(deleteEnd, 10));
                poll();
                return r;
              })
            }
          >
            {deleteCall.loading ? "..." : "Execute"}
          </button>
          <ResultBox result={deleteCall.result} />
        </div>

        <div className="method-card">
          <div className="method-name">rga_set_title(new_title)</div>
          <div className="method-inputs">
            <input
              className="form-control"
              placeholder="new title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <button
            className="btn-calimero"
            disabled={setTitleCall.loading}
            onClick={() =>
              setTitleCall.run(async () => {
                const r = await api.rgaSetTitle(title);
                poll();
                return r;
              })
            }
          >
            {setTitleCall.loading ? "..." : "set_title"}
          </button>
          <ResultBox result={setTitleCall.result} />
        </div>

        <div className="method-card">
          <div className="method-name">rga_clear()</div>
          <p style={{ fontSize: 12, color: "var(--color-text-muted)", marginBottom: 10 }}>
            Clears all text from the document.
          </p>
          <button
            className="btn-danger-outline"
            disabled={clearCall.loading}
            onClick={() =>
              clearCall.run(async () => {
                const r = await api.rgaClear();
                poll();
                return r;
              })
            }
          >
            {clearCall.loading ? "..." : "Execute"}
          </button>
          <ResultBox result={clearCall.result} />
        </div>
      </div>
    </div>
  );
}
