import { useCallback, useEffect, useState } from "react";
import { describeError } from "@calimero-apps/connect";

import type { KvStore } from "./kvStore";

type Result = { ok: unknown } | { err: string } | null;

/**
 * Which panel a call's output belongs under: every card shows its own last
 * result, directly under the buttons that produced it, and one section's call
 * does not wipe another's output.
 */
type Section = "write" | "read" | "remove" | "entries";

function ResultView({ result }: { result: Result }) {
  if (!result) return null;
  if ("err" in result) return <pre className="err">{result.err}</pre>;
  return <pre>{JSON.stringify(result.ok, null, 2)}</pre>;
}

/**
 * The store's methods, one card per kind of operation. `subscribe` (the app's
 * event stream) refreshes the table when anyone changes the store.
 */
export function KvPanel({
  kv,
  subscribe,
}: {
  kv: KvStore;
  subscribe?: (onChange: () => void) => () => void;
}) {
  const [entries, setEntries] = useState<Record<string, string>>({});
  const [listErr, setListErr] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  // Read and Remove own their keys: you can look one entry up, or delete one,
  // while composing another.
  const [readKey, setReadKey] = useState("");
  const [removeKey, setRemoveKey] = useState("");
  const [results, setResults] = useState<Partial<Record<Section, Result>>>({});
  const [busy, setBusy] = useState(false);
  // Two-step: "remove all" sits next to Refresh, where a mis-click is plausible.
  // Any other call disarms it.
  const [confirmClear, setConfirmClear] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setEntries(await kv.entries());
      setListErr(null);
      setLoaded(true);
    } catch (e) {
      setListErr(describeError(e));
    }
  }, [kv]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Another member's write arrives as an event: re-read rather than patch, so
  // the table is always what the contract says.
  useEffect(() => (subscribe ? subscribe(() => void refresh()) : undefined), [subscribe, refresh]);

  // Every call refreshes the listing afterwards. A KV store where the table
  // disagrees with the contract is worse than one that reloads too often.
  async function run(section: Section, label: string, fn: () => Promise<unknown>) {
    setBusy(true);
    setConfirmClear(false);
    setResults((r) => ({ ...r, [section]: null }));
    try {
      const ok = await fn();
      setResults((r) => ({ ...r, [section]: { ok: { [label]: ok ?? null } } }));
    } catch (e) {
      setResults((r) => ({
        ...r,
        [section]: { err: describeError(e) },
      }));
    } finally {
      setBusy(false);
      await refresh();
    }
  }

  const rows = Object.entries(entries);

  return (
    <>
      <div className="card">
        <h2>Write</h2>
        <div className="row">
          <input
            placeholder="key"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            aria-label="key"
          />
          <input
            placeholder="value"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            aria-label="value"
          />
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          <button
            disabled={busy || !key}
            onClick={() => run("write", "set", () => kv.set(key, value))}
          >
            set
          </button>
          {/*
            `updateIfExists` returns false rather than inserting: an absent
            key stays absent.
          */}
          <button
            className="ghost"
            disabled={busy || !key}
            onClick={() =>
              run("write", "updateIfExists", () => kv.updateIfExists(key, value))
            }
          >
            updateIfExists
          </button>
          {/* Returns the EXISTING value if there is one, not the argument. */}
          <button
            className="ghost"
            disabled={busy || !key}
            onClick={() => run("write", "getOrInsert", () => kv.getOrInsert(key, value))}
          >
            getOrInsert
          </button>
        </div>
        <ResultView result={results.write ?? null} />
      </div>

      <div className="card">
        <h2>Read</h2>
        <div className="row">
          <input
            placeholder="key"
            value={readKey}
            onChange={(e) => setReadKey(e.target.value)}
            aria-label="read key"
          />
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          {/* `null` for an absent key: the component ABI keeps the Option. */}
          <button
            className="ghost"
            disabled={busy || !readKey}
            onClick={() => run("read", "get", () => kv.get(readKey))}
          >
            get
          </button>
          {/* Returns a typed contract error for a missing key. */}
          <button
            className="ghost"
            disabled={busy || !readKey}
            onClick={() => run("read", "getResult", () => kv.getResult(readKey))}
          >
            getResult
          </button>
          {/*
            This one PANICS on a missing key. It is in the contract on purpose,
            as the counter-example — a panic aborts the whole execution, so
            nothing in this call is committed.
          */}
          <button
            className="ghost"
            disabled={busy || !readKey}
            onClick={() => run("read", "getUnchecked", () => kv.getUnchecked(readKey))}
          >
            getUnchecked
          </button>
          <button
            className="ghost"
            disabled={busy}
            onClick={() => run("read", "len", () => kv.len())}
          >
            len
          </button>
        </div>
        <ResultView result={results.read ?? null} />
      </div>

      <div className="card">
        <h2>Remove</h2>
        <div className="row">
          <input
            placeholder="key"
            value={removeKey}
            onChange={(e) => setRemoveKey(e.target.value)}
            aria-label="remove key"
          />
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          <button
            className="ghost"
            disabled={busy || !removeKey}
            onClick={() => run("remove", "remove", () => kv.remove(removeKey))}
          >
            remove
          </button>
        </div>
        <ResultView result={results.remove ?? null} />
      </div>

      <div className="card">
        <h2>Entries</h2>
        {listErr && <pre className="err">{listErr}</pre>}
        {rows.length === 0 ? (
          <p className="empty">
            {loaded ? "Empty." : "Loading…"}
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>key</th>
                <th>value</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(([k, v]) => (
                <tr key={k}>
                  <td className="mono">{k}</td>
                  <td className="mono">{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="row" style={{ marginTop: 14 }}>
          <button className="ghost" onClick={() => void refresh()}>
            Refresh
          </button>
          {/*
            `clear` lives here, next to Refresh, because it acts on the TABLE
            above it. It used to sit in the Remove card beside a single-key
            delete, which put "delete this one entry" and "delete all of them"
            one tab-stop apart.
          */}
          {confirmClear ? (
            <>
              <button
                className="danger"
                disabled={busy}
                onClick={() => run("entries", "clear", () => kv.clear())}
              >
                Confirm — remove all
              </button>
              <button className="ghost" disabled={busy} onClick={() => setConfirmClear(false)}>
                Cancel
              </button>
            </>
          ) : (
            <button
              className="ghost danger-text"
              disabled={busy || rows.length === 0}
              onClick={() => setConfirmClear(true)}
            >
              Remove all
            </button>
          )}
        </div>
        <ResultView result={results.entries ?? null} />
      </div>
    </>
  );
}
