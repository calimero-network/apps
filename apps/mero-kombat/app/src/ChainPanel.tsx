import { Zap } from "@calimero-network/mero-icons";
import type { TxStats } from "./useArena";

/**
 * The point of the app, on one card: every punch is a transaction, and here is
 * how many, how fast, and how long each took to come back from the node.
 */
export function ChainPanel({
  stats,
  totalActions,
  matchActions,
}: {
  stats: TxStats;
  totalActions: number;
  matchActions: number;
}) {
  const max = Math.max(4, ...stats.series);
  const w = 240;
  const h = 44;
  const pts = stats.series.map((n, i) => `${((i / (stats.series.length - 1)) * w).toFixed(1)},${(h - (n / max) * (h - 4) - 2).toFixed(1)}`);
  const area = `0,${h} ${pts.join(" ")} ${w},${h}`;

  return (
    <div className="card chain-card">
      <div className="card-head">
        <h2>
          <Zap size={16} aria-hidden="true" /> Chain activity
        </h2>
        <span className={`live-pill ${stats.tps > 0 ? "on" : ""}`}>
          <span className="dot" aria-hidden="true" />
          {stats.tps > 0 ? "Live" : "Idle"}
        </span>
      </div>

      <div className="stat-grid">
        <div className="stat big">
          <span className="stat-value" data-testid="tps">{stats.tps.toFixed(1)}</span>
          <span className="stat-label">your tx / sec</span>
        </div>
        <div className="stat big">
          <span className="stat-value">{stats.p50 ? `${stats.p50}` : "—"}<small>ms</small></span>
          <span className="stat-label">median confirm</span>
        </div>
        <div className="stat">
          <span className="stat-value" data-testid="arena-tx">{totalActions.toLocaleString()}</span>
          <span className="stat-label">arena transactions</span>
        </div>
        <div className="stat">
          <span className="stat-value">{matchActions.toLocaleString()}</span>
          <span className="stat-label">this match</span>
        </div>
      </div>

      <svg className="spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label="Confirmed transactions per second, last minute">
        <polygon points={area} className="spark-area" />
        <polyline points={pts.join(" ")} className="spark-line" />
      </svg>
      <div className="spark-axis">
        <span>60s ago</span>
        <span>peak {stats.peak}/s</span>
        <span>now</span>
      </div>

      {stats.recent.length > 0 ? (
        <ul className="tx-feed" aria-label="Your latest transactions">
          {stats.recent.slice(0, 7).map((tx) => (
            <li key={`${tx.id}-${tx.at}`} className={tx.ok ? "" : "failed"}>
              <span className={`tx-kind ${tx.hit ? (tx.blocked ? "blocked" : "hit") : ""}`}>{tx.kind.replace("_", " ")}</span>
              <span className="tx-result">{tx.ok ? (tx.hit ? (tx.blocked ? "blocked" : "hit") : "miss") : "refused"}</span>
              <span className="tx-ms mono">{tx.ms} ms</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="hint">Throw a punch — each one is signed, executed by the contract on your node and gossiped to your opponent&apos;s.</p>
      )}

      <details className="details">
        <summary>Details</summary>
        <dl className="kv-list">
          <dt>Sent / confirmed / refused</dt>
          <dd className="mono">
            {stats.sent} / {stats.ok} / {stats.failed}
          </dd>
          <dt>Confirm p95</dt>
          <dd className="mono">{stats.p95 ? `${stats.p95} ms` : "—"}</dd>
          <dt>Presence frames out / in</dt>
          <dd className="mono">
            {stats.framesOut.toFixed(0)}/s · {stats.framesIn.toFixed(0)}/s
          </dd>
          <dt>Method</dt>
          <dd className="mono">act(match_index, round, id, kind, hit, blocked, now)</dd>
        </dl>
        <p className="hint">
          Movement streams over ephemeral presence (no storage, no DAG). Every finished action — a punch, a
          kick, a jump, a block — is one contract call. Health is derived by the contract from those calls.
        </p>
        {stats.recent.find((t) => !t.ok)?.error && (
          <pre className="err">{stats.recent.find((t) => !t.ok)?.error}</pre>
        )}
      </details>
    </div>
  );
}
