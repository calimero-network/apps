import { useCallback, useEffect, useRef, useState } from "react";
import { useMero } from "@calimero-network/mero-react";
import type { EphemeralEntry } from "@calimero-network/mero-js";
import { ResultBox } from "../components/ResultBox";
import { getContextId } from "../lib/mero";

/**
 * Ephemeral presence — the one part of the platform that is NOT a contract call.
 *
 * Everything else in this app goes through `execute` into the WASM contract and
 * lands in the DAG. Presence does neither: it gossips node-to-node, encrypted,
 * runs no WASM, grows no DAG, and expires. That is why it was missing from this
 * scaffold entirely and why the contract-call checker could never have noticed —
 * there is no ABI method to be missing.
 *
 * The write/read asymmetry is the model, not an oversight:
 *
 *   * `set(contextId, state)` takes NO author. You can only ever write your own
 *     slot; the node resolves the author server-side from its owned context
 *     identity, which is also why a client cannot publish as somebody else.
 *   * `subscribe(contextId, handler)` yields EVERYONE's slots, so each entry
 *     carries its `author`.
 *
 * The store is N independent single-writer registers keyed by author. There is no
 * merge across authors — unlike every CRDT collection in the other sections.
 */

/** A presence slice shaped like something a real app would publish. */
interface Presence {
  label: string;
  cursor: number;
  at: number;
}

function shortAuthor(a: string) {
  return a.length > 18 ? `${a.slice(0, 10)}…${a.slice(-6)}` : a;
}

export function EphemeralPresence() {
  const { mero } = useMero();
  // `getContextId()`, NOT `useMero().contextId`.
  //
  // In AppMode.MultiContext the auth callback carries no context, so THIS APP
  // picks one (App.tsx's auto-select) and writes it with `setContextId`.
  // `useMero().contextId` reports what the auth flow handed over, which is null
  // in that mode — so reading it left every control here permanently disabled.
  // Every other section reaches the context the same way, via `rpcRaw`'s
  // `getContextId()` default.
  const contextId = getContextId();

  const [label, setLabel] = useState("alice");
  const [cursor, setCursor] = useState("42");
  const [setResult, setSetResult] = useState<unknown>(undefined);
  const [sending, setSending] = useState(false);

  const [subscribed, setSubscribed] = useState(false);
  const [entries, setEntries] = useState<Record<string, EphemeralEntry<Presence>>>({});
  const [events, setEvents] = useState(0);
  const [subErr, setSubErr] = useState<string | null>(null);
  const unsubRef = useRef<(() => void) | null>(null);

  const stop = useCallback(() => {
    unsubRef.current?.();
    unsubRef.current = null;
    setSubscribed(false);
  }, []);

  // Always release the SSE filter on unmount. Leaving it attached would keep
  // this section's handler firing after you navigate away.
  useEffect(() => stop, [stop]);

  function start() {
    if (!mero || !contextId) return;
    setSubErr(null);
    try {
      const unsub = mero.ephemeral.subscribe<Presence>(contextId, (entry) => {
        setEvents((n) => n + 1);
        setEntries((prev) => {
          const next = { ...prev };
          // `removed` is ABSENT (not false) on an upsert, and `state` is absent
          // on a removal — so both are checked for presence rather than truthiness.
          if (entry.removed) delete next[entry.author];
          else next[entry.author] = entry;
          return next;
        });
      });
      unsubRef.current = unsub;
      setSubscribed(true);
    } catch (e) {
      setSubErr(String(e));
    }
  }

  async function publish() {
    if (!mero || !contextId) return;
    setSending(true);
    try {
      const state: Presence = {
        label,
        cursor: Number(cursor) || 0,
        at: Date.now(),
      };
      await mero.ephemeral.set<Presence>(contextId, state);
      // `set` resolves with no value — there is nothing to echo back, so report
      // what was actually sent rather than an empty envelope.
      setSetResult({ sent: state });
    } catch (e) {
      // Rejects with an RpcError, so a typed failure such as an oversized slice
      // keeps its `type`/`data` (e.g. SliceTooLarge with the offending size).
      setSetResult({ error: String(e) });
    } finally {
      setSending(false);
    }
  }

  const rows = Object.values(entries);

  return (
    <div>
      <div className="section-header">
        <h2 className="section-title">Ephemeral Presence</h2>
        <p className="section-desc">
          Transient, encrypted, never-persisted state — cursors, typing
          indicators, who is online. It gossips between nodes without a WASM run
          and without DAG growth, and it expires: the node holds a{" "}
          <strong>7&nbsp;second TTL</strong> per author. This is the only section
          here that is <em>not</em> a contract call, so nothing about it appears in
          the ABI.{" "}
          {/*
            Stated up front rather than further down the page, because it is the
            fact that stops someone reaching for presence as a store: it is
            deliberately NOT a CRDT.
          */}
          Deliberately not a CRDT either — the store is N independent
          single-writer registers keyed by author, so two authors never merge,
          they sit side by side.
        </p>
      </div>

      <div className="method-grid">
        <div className="method-card">
          <div className="method-name">mero.ephemeral.set(contextId, state)</div>
          <div className="method-inputs">
            <input
              className="form-control"
              placeholder="label"
              aria-label="presence label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
            <input
              className="form-control"
              placeholder="cursor"
              aria-label="presence cursor"
              value={cursor}
              onChange={(e) => setCursor(e.target.value)}
            />
          </div>
          <button
            className="btn-calimero"
            disabled={sending || !mero || !contextId}
            onClick={publish}
            data-testid="ephemeral-set"
          >
            {sending ? "..." : "Publish my slice"}
          </button>
          <p className="method-hint">
            Takes no author. You can only write your OWN slot — the node resolves
            the author from its owned context identity, so a client cannot publish
            as somebody else. Each call replaces your slice wholesale.
          </p>
          <ResultBox result={setResult} />
        </div>

        <div className="method-card">
          <div className="method-name">mero.ephemeral.subscribe(contextId, handler)</div>
          <div className="method-inputs">
            <button
              className={subscribed ? "btn-calimero-outline" : "btn-calimero"}
              disabled={!mero || !contextId}
              onClick={subscribed ? stop : start}
              data-testid="ephemeral-subscribe"
            >
              {subscribed ? "Unsubscribe" : "Subscribe"}
            </button>
          </div>
          <p className="method-hint">
            Adds no transport — it is a typed filter over the SSE stream this app
            already has. On subscribing, the node <strong>replays</strong> the
            context&apos;s current presence to this connection as ordinary events
            before any live deltas. A replayed entry carries{" "}
            <code>ageMs</code>; a live delta does not — absent and{" "}
            <code>0</code> mean different things, so it is never synthesized.
          </p>
          <div
            data-testid="ephemeral-stats"
            style={{ display: "flex", gap: 14, marginTop: 8, fontSize: 12, color: "var(--color-text-muted)" }}
          >
            <span>events: {events}</span>
            <span>authors: {rows.length}</span>
          </div>
          {subErr && <ResultBox result={{ error: subErr }} />}
        </div>
      </div>

      <div className="method-card" style={{ marginTop: 16 }}>
        <div className="method-name">Live presence, by author</div>
        {!subscribed && rows.length === 0 && (
          <p className="method-hint">Subscribe to see presence arrive.</p>
        )}
        {subscribed && rows.length === 0 && (
          <p className="method-hint">
            Subscribed, nothing yet. Publish a slice above — or open this app in a
            second tab against another node in the same context, which is the case
            worth watching: the store is N single-writer registers keyed by author,
            so two tabs never merge, they sit side by side.
          </p>
        )}
        {rows.length > 0 && (
          <table
            data-testid="ephemeral-table"
            style={{ width: "100%", borderCollapse: "collapse", marginTop: 8 }}
          >
            <thead>
              <tr>
                {["author", "label", "cursor", "ageMs", "source"].map((h) => (
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
              {rows.map((e) => (
                <tr key={e.author} style={{ borderBottom: "1px solid var(--color-border)" }}>
                  <td style={{ padding: "8px", fontSize: 11, fontFamily: "monospace" }} title={e.author}>
                    {shortAuthor(e.author)}
                  </td>
                  <td style={{ padding: "8px", fontSize: 13 }}>{e.state?.label ?? "—"}</td>
                  <td style={{ padding: "8px", fontSize: 12, fontFamily: "monospace" }}>
                    {e.state?.cursor ?? "—"}
                  </td>
                  <td style={{ padding: "8px", fontSize: 12, fontFamily: "monospace" }}>
                    {e.ageMs ?? "—"}
                  </td>
                  {/* The whole point of ageMs: it tells a replayed seed entry
                      apart from a live one, with no clock agreement between
                      machines needed. */}
                  <td style={{ padding: "8px", fontSize: 12, color: "var(--color-text-muted)" }}>
                    {e.ageMs === undefined ? "live delta" : "replayed"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
