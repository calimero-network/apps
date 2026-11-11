import { useCallback, useEffect, useRef, useState } from "react";
import { presenceState, type PresenceEntry } from "@calimero-network/mero-js";
import { describeError } from "@calimero-apps/connect";
import { ResultBox } from "../components/ResultBox";
import { getConnection } from "../lib/calimero";

/**
 * Ephemeral presence — the one part of the platform that is NOT a contract call.
 *
 * Everything else in this app goes through `client.call`/`client.view` into the
 * component and, for a call, lands in the app's log. Presence does neither: the
 * node keeps it in memory per app instance, runs no app code, logs nothing, and
 * forgets it. There is no ABI method for it.
 *
 * The write/read asymmetry is the model, not an oversight:
 *
 *   * `publishPresence(app, seq, state)` takes NO author. You can only ever
 *     write your own slot (your account on this device); the node takes the
 *     author from the session, so a client cannot publish as somebody else.
 *     `seq` orders your own updates; `null` retracts the slot.
 *   * `presenceStream(app)` yields EVERYONE's slots — a `snapshot` first, then
 *     one `presence` event per change — so each entry carries its `account`
 *     and `device`.
 *
 * The store is N independent single-writer registers keyed by author. There is
 * no merge across authors.
 */

/** A presence slice shaped like something a real app would publish. */
interface Presence {
  label: string;
  cursor: number;
  at: number;
}

interface Row {
  account: string;
  device: string;
  state: Presence | null;
  source: "snapshot" | "live";
}

function shortAuthor(a: string) {
  return a.length > 18 ? `${a.slice(0, 10)}…${a.slice(-6)}` : a;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** A slot's state (hex of the JSON bytes we published), or null for anything else. */
function decodeState(hex: string | null): Presence | null {
  if (!hex) return null;
  try {
    const bytes = new Uint8Array((hex.match(/../g) ?? []).map((h) => parseInt(h, 16)));
    return JSON.parse(new TextDecoder().decode(bytes)) as Presence;
  } catch {
    return null;
  }
}

export function EphemeralPresence() {
  const conn = getConnection();
  const appId = conn?.appId ?? null;

  const [label, setLabel] = useState("alice");
  const [cursor, setCursor] = useState("42");
  const [setResult, setSetResult] = useState<unknown>(undefined);
  const [sending, setSending] = useState(false);

  const [subscribed, setSubscribed] = useState(false);
  const [entries, setEntries] = useState<Record<string, Row>>({});
  const [events, setEvents] = useState(0);
  const [subErr, setSubErr] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const seqRef = useRef(0);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setSubscribed(false);
  }, []);

  // Always close the stream on unmount.
  useEffect(() => stop, [stop]);

  function apply(entry: PresenceEntry, source: Row["source"]) {
    const key = `${entry.account}/${entry.device}`;
    setEntries((prev) => {
      const next = { ...prev };
      if (entry.state === null) delete next[key];
      else next[key] = { account: entry.account, device: entry.device, state: decodeState(entry.state), source };
      return next;
    });
  }

  function start() {
    if (!conn || !appId) return;
    setSubErr(null);
    const abort = new AbortController();
    abortRef.current = abort;
    setSubscribed(true);
    void (async () => {
      try {
        for await (const event of conn.client.presenceStream(appId, abort.signal)) {
          setEvents((n) => n + 1);
          if (event.kind === "snapshot") {
            setEntries({});
            for (const entry of (event.data as PresenceEntry[]) ?? []) apply(entry, "snapshot");
          } else {
            apply(event.data as PresenceEntry, "live");
          }
        }
      } catch (e) {
        if (!abort.signal.aborted) setSubErr(describeError(e));
      } finally {
        if (abortRef.current === abort) setSubscribed(false);
      }
    })();
  }

  async function publish(retract = false) {
    if (!conn || !appId) return;
    setSending(true);
    try {
      const state: Presence = { label, cursor: Number(cursor) || 0, at: Date.now() };
      seqRef.current += 1;
      const bytes = retract ? null : new TextEncoder().encode(JSON.stringify(state));
      // `null` retracts; the document types `state` as a string only.
      await conn.client.apps.presencePublish({
        app: appId,
        seq: seqRef.current,
        state: presenceState(bytes) as unknown as string,
      });
      // Resolves with no value — report what was actually sent.
      setSetResult(retract ? { retracted: true, seq: seqRef.current } : { sent: state, seq: seqRef.current, hex: toHex(new TextEncoder().encode(JSON.stringify(state))).slice(0, 32) + "…" });
    } catch (e) {
      setSetResult({ error: describeError(e) });
    } finally {
      setSending(false);
      conn.after();
    }
  }

  const rows = Object.values(entries);

  return (
    <div>
      <div className="section-header">
        <h2 className="section-title">Ephemeral Presence</h2>
        <p className="section-desc">
          Transient, never-persisted state — cursors, typing indicators, who is
          online. The node keeps it in memory per app instance, without running
          the app and without a log entry. This is the only section here that
          is <em>not</em> a contract call, so nothing about it appears in the
          ABI.{" "}
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
          <div className="method-name">client.publishPresence(app, seq, state)</div>
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
            disabled={sending || !appId}
            onClick={() => void publish()}
            data-testid="ephemeral-set"
          >
            {sending ? "..." : "Publish my slice"}
          </button>
          <button
            className="btn-calimero-outline"
            disabled={sending || !appId}
            onClick={() => void publish(true)}
            style={{ marginLeft: 8 }}
          >
            Retract
          </button>
          <p className="method-hint">
            Takes no author. You can only write your OWN slot — the node takes
            the author from the session, so a client cannot publish as somebody
            else. Each call replaces your slice wholesale; a higher{" "}
            <code>seq</code> wins, and <code>null</code> retracts it.
          </p>
          <ResultBox result={setResult} />
        </div>

        <div className="method-card">
          <div className="method-name">client.presenceStream(app)</div>
          <div className="method-inputs">
            <button
              className={subscribed ? "btn-calimero-outline" : "btn-calimero"}
              disabled={!appId}
              onClick={subscribed ? stop : start}
              data-testid="ephemeral-subscribe"
            >
              {subscribed ? "Unsubscribe" : "Subscribe"}
            </button>
          </div>
          <p className="method-hint">
            A stream of its own: a <code>snapshot</code> event with everyone
            present when it opens, then one <code>presence</code> event per
            change. The table marks which of the two each row came from.
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
            second browser profile signed in as another account of the same
            instance, which is the case worth watching: the store is N single-writer registers keyed by author,
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
                {["account", "device", "label", "cursor", "source"].map((h) => (
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
                <tr key={`${e.account}/${e.device}`} style={{ borderBottom: "1px solid var(--color-border)" }}>
                  <td style={{ padding: "8px", fontSize: 11, fontFamily: "monospace" }} title={e.account}>
                    {shortAuthor(e.account)}
                  </td>
                  <td style={{ padding: "8px", fontSize: 11, fontFamily: "monospace" }} title={e.device}>
                    {shortAuthor(e.device)}
                  </td>
                  <td style={{ padding: "8px", fontSize: 13 }}>{e.state?.label ?? "—"}</td>
                  <td style={{ padding: "8px", fontSize: 12, fontFamily: "monospace" }}>
                    {e.state?.cursor ?? "—"}
                  </td>
                  <td style={{ padding: "8px", fontSize: 12, color: "var(--color-text-muted)" }}>
                    {e.source === "live" ? "live" : "snapshot"}
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
