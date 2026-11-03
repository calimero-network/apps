import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppMode, ConnectButton, MeroProvider, useMero, type AdminApiClient } from '@calimero-network/mero-react';
import { PHASES, type Session } from './conformance/matrix';
import { sleep } from './conformance/check';
import type { Streams } from './conformance/listen';
import type { ConformanceApi, Mode, Row } from './conformance/types';
import { readConfig } from './config';

const config = readConfig();

/**
 * The node a desktop hand-over names in the URL fragment (`#node_url=…`), read
 * once before the provider mounts. Passing it as `allowedNodeUrls` is what lets
 * MeroProvider accept that handed-over session instead of default-denying a node
 * it has never seen; see the apps repo's `scripts/check-desktop-sso.py`. Trust
 * is compared by origin, so only the origin is kept.
 */
function hashNodeUrl(): string | undefined {
  try {
    const p = new URLSearchParams(window.location.hash.slice(1));
    const raw = (p.get('node_url') ?? p.get('nodeUrl') ?? '').trim();
    return raw ? new URL(raw).origin : undefined;
  } catch {
    return undefined;
  }
}
const trustedNodeUrl = hashNodeUrl();

export function App() {
  return (
    <MeroProvider
      mode={AppMode.MultiContext}
      packageName={config.packageName}
      packageVersion={config.packageVersion}
      {...(config.registryUrl ? { registryUrl: config.registryUrl } : {})}
      {...(config.cloudBaseUrl ? { cloudBaseUrl: config.cloudBaseUrl } : {})}
      allowedNodeUrls={trustedNodeUrl ? [trustedNodeUrl] : undefined}
    >
      <Shell />
    </MeroProvider>
  );
}

function Shell() {
  const mero = useMero();
  const [rows, setRows] = useState<Row[]>([]);
  const [running, setRunning] = useState<string | null>(null);
  // Every row reads the CURRENT connection: an account's join replaces its
  // admin and client mid-run, and a row must not call through the old one.
  const live = useRef(mero);
  live.current = mero;
  const rowsRef = useRef<Row[]>([]);

  const mode: Mode | null = mero.isAuthenticated ? (mero.isDelegated ? 'account' : 'node') : null;
  const ready = Boolean(mero.isAuthenticated && mero.admin && !mero.isLoading);

  const record = useCallback((row: Row) => {
    rowsRef.current = [...rowsRef.current, row];
    setRows(rowsRef.current);
  }, []);

  const session = useMemo<Session | null>(() => {
    if (!mode) return null;
    return {
      run: config.run ?? mode,
      mode,
      session: config.session,
      record,
      admin: () => {
        const a = live.current.admin;
        if (!a) throw new Error('not connected: no admin');
        return a;
      },
      execute: async (contextId, method, args) => {
        const client = live.current.mero;
        if (!client) throw new Error('not connected: no client to execute through');
        return client.rpc.execute({ contextId, method, argsJson: args ?? {} });
      },
      streams: () => {
        const client = live.current.mero;
        if (!client) throw new Error('not connected: no client to listen through');
        // What `useSubscription` and `useEphemeral` read. Cast: mero-js's `MeroJs`
        // type predates `ephemeral`, which both clients have at runtime.
        const c = client as unknown as Streams & { ephemeral: Streams['presence'] };
        return {
          get events() {
            return c.events;
          },
          get presence() {
            return c.ephemeral;
          },
        };
      },
      settle: async (previous: AdminApiClient | null) => {
        const deadline = Date.now() + 60_000;
        for (;;) {
          const m = live.current;
          if (m.isAuthenticated && m.admin && m.admin !== previous && !m.isLoading && m.mero) return;
          if (Date.now() > deadline) throw new Error('the session did not reconnect within 60 s of the call');
          await sleep(250);
        }
      },
    };
    // `mode` is stable for a session; the getters read `live`.
  }, [mode, record]);
  const sessionRef = useRef(session);
  sessionRef.current = session;

  const run = useCallback(async (phase: string, input?: unknown) => {
    const s = sessionRef.current;
    const fn = PHASES[phase];
    if (!s) throw new Error('not connected');
    if (!fn) throw new Error(`no phase ${phase}`);
    setRunning(phase);
    try {
      return await fn(s, input as never);
    } finally {
      setRunning(null);
    }
  }, []);

  useEffect(() => {
    const api: ConformanceApi = { ready, mode, rows, run };
    window.__conformance = api;
  }, [ready, mode, rows, run]);

  const passed = rows.filter((r) => r.pass).length;
  return (
    <main>
      <header>
        <h1>Conformance</h1>
        <p className="lede">
          Every admin and RPC call an app makes, under the connection this tab holds. A row passes only when what
          happened is what this mode expects: <code>ok</code>, or a refusal mero-react names.
        </p>
        <div className="bar">
          <ConnectButton cloud />
          <span className="pill" data-testid="mode">{mode ?? 'not connected'}</span>
          <span className="pill">{config.session}</span>
          {running && <span className="pill busy">running {running}</span>}
          {rows.length > 0 && (
            <span className={`pill ${passed === rows.length ? 'ok' : 'bad'}`} data-testid="summary">
              {passed}/{rows.length} pass
            </span>
          )}
        </div>
      </header>
      <section>
        <div className="scroll">
          <table data-testid="report">
            <thead>
              <tr>
                <th>check</th>
                <th>mode</th>
                <th>expected</th>
                <th>actual</th>
                <th>ms</th>
                <th>error / detail</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className={r.pass ? 'pass' : 'fail'}>
                  <td>{r.name}</td>
                  <td>{r.mode}</td>
                  <td>{r.expected}</td>
                  <td>{r.actual}</td>
                  <td className="num">{r.ms}</td>
                  <td className="err">{r.error ?? r.detail ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rows.length === 0 && <p className="empty">No rows yet. The runner drives this page; see the README.</p>}
      </section>
    </main>
  );
}
