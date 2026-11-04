import { useCallback, useEffect, useState } from "react";
import { describeError, connectTarget, type Target } from "@calimero-apps/connect";

import { clientAt, softPasskey } from "./conformance/env";
import type { Row } from "./conformance/types";
import { defaultDeps, type AppDeps } from "./deps";
import { PACKAGE } from "./conformance/contract";

/** A picked file's bytes (FileReader: what every browser, and jsdom, has). */
function readBytes(file: Blob): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error ?? new Error("could not read the file"));
    reader.readAsArrayBuffer(file);
  });
}

type State =
  | { status: "connecting" }
  | { status: "unconfigured"; message: string }
  | { status: "ready"; target: Target };

/**
 * The matrix, run from the page: every call a component app's client makes,
 * as accounts this page signs up with software passkeys, on the cluster the
 * build targets (`merod local` under `pnpm dev:local conformance`). The
 * component it deploys is the one you pick (`logic/res/conformance.wasm`,
 * which `dev:local` builds). CI runs the same matrix from Node
 * (`pnpm test:cluster`).
 */
export function App({ deps = defaultDeps }: { deps?: AppDeps }) {
  const [state, setState] = useState<State>({ status: "connecting" });
  const [wasm, setWasm] = useState<Uint8Array | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    Promise.resolve()
      .then(() => connectTarget(deps.env, { servedNodes: deps.servedNodes, package: PACKAGE }))
      .then((target) => live && setState({ status: "ready", target }))
      .catch((e: unknown) => live && setState({ status: "unconfigured", message: describeError(e) }));
    return () => {
      live = false;
    };
  }, [deps]);

  const run = useCallback(async () => {
    if (state.status !== "ready" || !wasm) return;
    setRows([]);
    setError(null);
    setRunning(true);
    try {
      const target = state.target;
      await deps.run({
        client: (i) => clientAt(target, i),
        passkey: () => softPasskey(deps.origin),
        wasm,
        onRow: (row) => setRows((r) => [...r, row]),
      });
    } catch (e) {
      setError(describeError(e));
    } finally {
      setRunning(false);
    }
  }, [deps, state, wasm]);

  const passed = rows.filter((r) => r.pass).length;
  return (
    <main>
      <header>
        <h1>Conformance</h1>
        <p className="lede">
          Every call a component app&apos;s client makes, on a Calimero 1.0 cluster, as two accounts. A row passes only
          when what happened is what it expects: <code>ok</code>, or a refusal the node names.
        </p>
        {state.status === "connecting" && <p className="empty">Connecting…</p>}
        {state.status === "unconfigured" && <p className="empty" role="alert">{state.message}</p>}
        {state.status === "ready" && (
          <div className="bar">
            <span className="pill" data-testid="target">
              {state.target.kind === "local" ? `local: ${state.target.nodes.length} nodes` : `cloud: ${state.target.cluster}`}
            </span>
            <label className="pill">
              component{" "}
              <input
                type="file"
                accept=".wasm,application/wasm"
                aria-label="component"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void readBytes(file).then(setWasm, (err: unknown) => setError(describeError(err)));
                }}
              />
            </label>
            <button type="button" disabled={!wasm || running} onClick={() => void run()}>
              {running ? "running…" : "Run the matrix"}
            </button>
            {rows.length > 0 && (
              <span className={`pill ${passed === rows.length ? "ok" : "bad"}`} data-testid="summary">
                {passed}/{rows.length} pass
              </span>
            )}
          </div>
        )}
        {error && <p className="empty" role="alert">{error}</p>}
      </header>
      <section>
        <div className="scroll">
          <table data-testid="report">
            <thead>
              <tr>
                <th>check</th>
                <th>who</th>
                <th>expected</th>
                <th>actual</th>
                <th>ms</th>
                <th>error / detail</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className={r.pass ? "pass" : "fail"}>
                  <td>{r.name}</td>
                  <td>{r.who}</td>
                  <td>{r.expected}</td>
                  <td>{r.actual}</td>
                  <td className="num">{r.ms}</td>
                  <td className="err">{r.error ?? r.detail ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rows.length === 0 && (
          <p className="empty">
            No rows yet. Pick the built component (<code>apps/conformance/logic/res/conformance.wasm</code>) and run the
            matrix; see the README.
          </p>
        )}
      </section>
    </main>
  );
}
