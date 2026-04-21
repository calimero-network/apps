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

export function CrdtCounters() {
  const [gKey, setGKey] = useState("hits");
  const [pnKey, setPnKey] = useState("score");
  const [liveG, setLiveG] = useState<number | null>(null);
  const [livePn, setLivePn] = useState<number | null>(null);

  const incG = useCall();
  const incPn = useCall();
  const decPn = useCall();

  const poll = useCallback(async () => {
    if (gKey) {
      const res = await api.getGCounter(gKey);
      const v = (res as { result?: { output?: number } })?.result?.output;
      if (v !== undefined) setLiveG(v);
    }
    if (pnKey) {
      const res = await api.getPnCounter(pnKey);
      const v = (res as { result?: { output?: number } })?.result?.output;
      if (v !== undefined) setLivePn(v);
    }
  }, [gKey, pnKey]);

  const { pulse, sinceLabel } = useAutoRefresh(poll, 3000);

  return (
    <div>
      <div className="section-header">
        <h2 className="section-title">CRDT Counters</h2>
        <p className="section-desc">
          Conflict-free counters that merge across nodes.{" "}
          <strong>G-Counter</strong>: grow-only (increment only).{" "}
          <strong>PN-Counter</strong>: supports both increment and decrement.
          Values auto-refresh every 3 s — increment on Node A and watch the count
          update on Node B.
        </p>
      </div>

      {/* Live values */}
      <div className="method-card" style={{ marginBottom: 16 }}>
        <SyncBar pulse={pulse} sinceLabel={sinceLabel} onRefresh={poll} />
        <div className="method-name">Live counter values</div>
        <div style={{ display: "flex", gap: 16, marginTop: 8 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginBottom: 4 }}>
              G-Counter <code style={{ fontSize: 10 }}>{gKey || "(no key)"}</code>
            </div>
            <div style={{ fontSize: 28, fontWeight: 700, color: "var(--color-brand-600)" }}>
              {liveG ?? "—"}
            </div>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginBottom: 4 }}>
              PN-Counter <code style={{ fontSize: 10 }}>{pnKey || "(no key)"}</code>
            </div>
            <div style={{ fontSize: 28, fontWeight: 700, color: "var(--color-brand-600)" }}>
              {livePn ?? "—"}
            </div>
          </div>
        </div>
      </div>

      <div className="method-grid">
        <div className="method-card">
          <div className="method-name">
            G-Counter — increment_g_counter / get_g_counter
          </div>
          <div className="method-inputs">
            <input
              className="form-control"
              placeholder="counter key (e.g. hits)"
              value={gKey}
              onChange={(e) => setGKey(e.target.value)}
            />
          </div>
          <button
            className="btn-calimero"
            disabled={incG.loading}
            onClick={() => incG.run(async () => { const r = await api.incrementGCounter(gKey); poll(); return r; })}
          >
            {incG.loading ? "..." : "increment"}
          </button>
          <ResultBox result={incG.result} />
        </div>

        <div className="method-card">
          <div className="method-name">
            PN-Counter — increment / decrement / get
          </div>
          <div className="method-inputs">
            <input
              className="form-control"
              placeholder="counter key (e.g. score)"
              value={pnKey}
              onChange={(e) => setPnKey(e.target.value)}
            />
          </div>
          <div className="input-row">
            <button
              className="btn-calimero"
              disabled={incPn.loading}
              onClick={() => incPn.run(async () => { const r = await api.incrementPnCounter(pnKey); poll(); return r; })}
            >
              {incPn.loading ? "..." : "+ inc"}
            </button>
            <button
              className="btn-danger-outline"
              disabled={decPn.loading}
              onClick={() => decPn.run(async () => { const r = await api.decrementPnCounter(pnKey); poll(); return r; })}
            >
              {decPn.loading ? "..." : "− dec"}
            </button>
          </div>
          <ResultBox result={incPn.result} />
          <ResultBox result={decPn.result} />
        </div>
      </div>
    </div>
  );
}
