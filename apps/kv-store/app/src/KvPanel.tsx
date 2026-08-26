import { useCallback, useEffect, useState } from "react";
import { useKvStore } from "./useKvStore";

type Result = { ok: unknown } | { err: string } | null;

function show(r: Result) {
  if (!r) return null;
  if ("err" in r) return <pre className="err">{r.err}</pre>;
  return <pre>{JSON.stringify(r.ok, null, 2)}</pre>;
}

export function KvPanel({ contextId }: { contextId: string }) {
  const kv = useKvStore(contextId);

  const [entries, setEntries] = useState<Record<string, string>>({});
  const [listErr, setListErr] = useState<string | null>(null);
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  const [result, setResult] = useState<Result>(null);
  const [busy, setBusy] = useState(false);

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
  async function run(label: string, fn: () => Promise<unknown>) {
    setBusy(true);
    setResult(null);
    try {
      const ok = await fn();
      setResult({ ok: { [label]: ok ?? null } });
    } catch (e) {
      setResult({ err: e instanceof Error ? e.message : String(e) });
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
          <button disabled={busy || !key} onClick={() => run("set", () => kv.set({ key, value }))}>
            set
          </button>
          {/*
            `update_if_exists` returns false rather than inserting — it is the
            `get_mut` path, an in-place mutation with no read-modify-write.
          */}
          <button
            className="ghost"
            disabled={busy || !key}
            onClick={() => run("update_if_exists", () => kv.updateIfExists({ key, value }))}
          >
            update_if_exists
          </button>
          {/* `entry().or_insert()` — returns the EXISTING value if there is one. */}
          <button
            className="ghost"
            disabled={busy || !key}
            onClick={() => run("get_or_insert", () => kv.getOrInsert({ key, value }))}
          >
            get_or_insert
          </button>
        </div>
      </div>

      <div className="card">
        <h2>Read</h2>
        <div className="row">
          {/* Typed `Promise<string>`, actually nullable — see useKvStore. */}
          <button className="ghost" disabled={busy || !key} onClick={() => run("get", () => kv.get({ key }))}>
            get
          </button>
          {/* Returns a typed contract error for a missing key. */}
          <button
            className="ghost"
            disabled={busy || !key}
            onClick={() => run("get_result", () => kv.getResult({ key }))}
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
            disabled={busy || !key}
            onClick={() => run("get_unchecked", () => kv.getUnchecked({ key }))}
          >
            get_unchecked
          </button>
          <button className="ghost" disabled={busy} onClick={() => run("len", () => kv.len())}>
            len
          </button>
        </div>
      </div>

      <div className="card">
        <h2>Remove</h2>
        <div className="row">
          <button
            className="ghost"
            disabled={busy || !key}
            onClick={() => run("remove", () => kv.remove({ key }))}
          >
            remove
          </button>
          <button className="ghost" disabled={busy} onClick={() => run("clear", () => kv.clear())}>
            clear
          </button>
        </div>
        {show(result)}
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
        </div>
      </div>
    </>
  );
}
