import { useCallback, useEffect, useState } from "react";
import { useKvStore } from "./useKvStore";

type Result = { ok: unknown } | { err: string } | null;

/**
 * Which panel a call's output belongs under.
 *
 * Results used to be ONE piece of state rendered once, at the bottom of the
 * Remove card. So pressing `set` in Write printed `{"set": null}` two cards
 * further down, under a heading that had nothing to do with it — and pressing
 * `get` replaced it in the same faraway place. The output was correct and read
 * as noise.
 *
 * Keyed by section instead: every card shows its own last result, directly under
 * the buttons that produced it, and one section's call no longer wipes another's
 * output.
 */
type Section = "write" | "read" | "remove" | "entries";

function ResultView({ result }: { result: Result }) {
  if (!result) return null;
  if ("err" in result) return <pre className="err">{result.err}</pre>;
  return <pre>{JSON.stringify(result.ok, null, 2)}</pre>;
}

export function KvPanel({ contextId }: { contextId: string }) {
  const kv = useKvStore(contextId);

  const [entries, setEntries] = useState<Record<string, string>>({});
  const [listErr, setListErr] = useState<string | null>(null);
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  // The read section owns its key. It used to share `key` with Write, which
  // meant you could not look up one entry while composing another, and the
  // read buttons went disabled the moment the write field was cleared.
  const [readKey, setReadKey] = useState("");
  // Remove owns its key for the same reason, and it is the more surprising of
  // the two: `remove` was wired to the WRITE field, so deleting an entry meant
  // typing its name into a box labelled "key" under a heading called Write,
  // three cards above the button you were about to press.
  const [removeKey, setRemoveKey] = useState("");
  const [results, setResults] = useState<Partial<Record<Section, Result>>>({});
  const [busy, setBusy] = useState(false);
  // Two-step, because this button now sits next to Refresh under the table
  // where a mis-click is a plausible way to lose every entry. It resets on any
  // other call, so it cannot stay armed by accident.
  const [confirmClear, setConfirmClear] = useState(false);

  const refresh = useCallback(async () => {
    if (!kv) return;
    try {
      setEntries(await kv.entries());
      setListErr(null);
    } catch (e) {
      setListErr(e instanceof Error ? e.message : String(e));
    }
  }, [kv]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

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
        [section]: { err: e instanceof Error ? e.message : String(e) },
      }));
    } finally {
      setBusy(false);
      await refresh();
    }
  }

  if (!kv) {
    return (
      <div className="card">
        <p className="empty">No node client — the session is not connected.</p>
      </div>
    );
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
            onClick={() => run("write", "set", () => kv.set({ key, value }))}
          >
            set
          </button>
          {/*
            `update_if_exists` returns false rather than inserting — it is the
            `get_mut` path, an in-place mutation with no read-modify-write.
          */}
          <button
            className="ghost"
            disabled={busy || !key}
            onClick={() =>
              run("write", "update_if_exists", () => kv.updateIfExists({ key, value }))
            }
          >
            update_if_exists
          </button>
          {/* `entry().or_insert()` — returns the EXISTING value if there is one. */}
          <button
            className="ghost"
            disabled={busy || !key}
            onClick={() => run("write", "get_or_insert", () => kv.getOrInsert({ key, value }))}
          >
            get_or_insert
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
          {/* Typed `Promise<string>`, actually nullable — see useKvStore. */}
          <button
            className="ghost"
            disabled={busy || !readKey}
            onClick={() => run("read", "get", () => kv.get({ key: readKey }))}
          >
            get
          </button>
          {/* Returns a typed contract error for a missing key. */}
          <button
            className="ghost"
            disabled={busy || !readKey}
            onClick={() => run("read", "get_result", () => kv.getResult({ key: readKey }))}
          >
            get_result
          </button>
          {/*
            This one PANICS on a missing key. It is in the contract on purpose,
            as the counter-example — a panic aborts the whole execution, so
            nothing in this call is committed.
          */}
          <button
            className="ghost"
            disabled={busy || !readKey}
            onClick={() => run("read", "get_unchecked", () => kv.getUnchecked({ key: readKey }))}
          >
            get_unchecked
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
            onClick={() => run("remove", "remove", () => kv.remove({ key: removeKey }))}
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
          <p className="empty">Empty.</p>
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
