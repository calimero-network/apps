import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalimeroError,
  browserPasskey,
  type CalimeroSession,
  type CloudEvent,
} from "@calimero-network/mero-js";
import {
  CLUSTER_URL,
  newClient,
  saveSession,
  saveStore,
  savedSession,
  savedStore,
} from "./cloud";

function message(e: unknown): string {
  if (e instanceof CalimeroError) return `${e.code}: ${e.message}`;
  return e instanceof Error ? e.message : String(e);
}

export function App() {
  const client = useMemo(newClient, []);
  const [session, setSession] = useState<CalimeroSession | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Resume a saved session, refreshing it when it has expired.
  useEffect(() => {
    const saved = savedSession();
    if (!saved) {
      setReady(true);
      return;
    }
    client.useSession(saved);
    const fresh =
      saved.expiresAt > Date.now() / 1000 + 30 ? Promise.resolve(saved) : client.refresh();
    fresh
      .then((s) => {
        saveSession(s);
        setSession(s);
      })
      .catch(() => saveSession(null))
      .finally(() => setReady(true));
  }, [client]);

  const signedIn = useCallback((s: CalimeroSession) => {
    saveSession(s);
    setSession(s);
    setError(null);
  }, []);

  async function signOut() {
    await client.signOut().catch(() => undefined);
    saveSession(null);
    saveStore(null);
    setSession(null);
  }

  return (
    <div className="wrap">
      <header>
        <h1>KV Store</h1>
        <p className="sub">
          The reference app on Calimero Cloud: a WASM contract replicated across
          attested nodes, reached through a sealed channel, signed in with a
          passkey. Cluster: <code>{CLUSTER_URL}</code>
        </p>
      </header>
      {error && (
        <pre className="err" data-testid="error">
          {error}
        </pre>
      )}
      {!ready ? (
        <div className="card">
          <p className="empty">Connecting…</p>
        </div>
      ) : !session ? (
        <SignIn
          onSignUp={(name) => client.signUp(browserPasskey(), name).then(signedIn, (e) => setError(message(e)))}
          onSignIn={() => client.signIn(browserPasskey()).then(signedIn, (e) => setError(message(e)))}
        />
      ) : (
        <>
          <div className="card row">
            <span data-testid="account">Signed in as {session.accountId.slice(0, 10)}…</span>
            <button onClick={signOut} data-testid="sign-out">
              Sign out
            </button>
          </div>
          <Store client={client} onError={setError} />
        </>
      )}
    </div>
  );
}

function SignIn(props: { onSignUp: (name: string) => void; onSignIn: () => void }) {
  const [name, setName] = useState("");
  return (
    <div className="card">
      <h2>Sign in</h2>
      <p className="empty">Your passkey is your account. No password, no node to run.</p>
      <div className="row">
        <input
          placeholder="your name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          data-testid="name"
        />
        <button disabled={!name} onClick={() => props.onSignUp(name)} data-testid="sign-up">
          Create account
        </button>
        <button onClick={props.onSignIn} data-testid="sign-in">
          Sign in with a passkey
        </button>
      </div>
    </div>
  );
}

type Client = ReturnType<typeof newClient>;

function Store({ client, onError }: { client: Client; onError: (e: string | null) => void }) {
  const [appId, setAppId] = useState<string | null>(savedStore);
  const [stores, setStores] = useState<Array<{ appId: string; name: string }>>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    client
      .get<{ apps: Array<{ appId: string; name: string }> }>("apps")
      .then((r) => setStores(r.apps), (e) => onError(message(e)));
  }, [client, onError, appId]);

  async function createStore() {
    setBusy(true);
    try {
      // The contract ships with the frontend: `scripts/copy-wasm.mjs` puts the
      // built kv_store.wasm in public/.
      const wasm = new Uint8Array(await (await fetch(`${import.meta.env.BASE_URL}kv_store.wasm`)).arrayBuffer());
      const bundle = await client.uploadBundle(wasm);
      const id = await client.createApp("kv", bundle);
      saveStore(id);
      setAppId(id);
      onError(null);
    } catch (e) {
      onError(message(e));
    } finally {
      setBusy(false);
    }
  }

  if (!appId) {
    return (
      <div className="card">
        <h2>Your stores</h2>
        {stores.length === 0 && <p className="empty">None yet.</p>}
        <ul>
          {stores.map((s) => (
            <li key={s.appId}>
              <button
                onClick={() => {
                  saveStore(s.appId);
                  setAppId(s.appId);
                }}
              >
                Open {s.name} ({s.appId.slice(0, 8)})
              </button>
            </li>
          ))}
        </ul>
        <button disabled={busy} onClick={createStore} data-testid="create-store">
          {busy ? "Creating…" : "Create a store"}
        </button>
      </div>
    );
  }
  return (
    <KvPanel
      client={client}
      appId={appId}
      onError={onError}
      onClose={() => {
        saveStore(null);
        setAppId(null);
      }}
    />
  );
}

function KvPanel(props: { client: Client; appId: string; onError: (e: string | null) => void; onClose: () => void }) {
  const { client, appId, onError } = props;
  const [entries, setEntries] = useState<Record<string, string>>({});
  const [events, setEvents] = useState<CloudEvent[]>([]);
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  const [readKey, setReadKey] = useState("");
  const [read, setRead] = useState<string | null | undefined>(undefined);

  const reload = useCallback(async () => {
    try {
      const r = await client.view(appId, "entries", {});
      setEntries((r.result ?? {}) as Record<string, string>);
    } catch (e) {
      onError(message(e));
    }
  }, [client, appId, onError]);

  // Committed events from the start, then live: every write anywhere reloads.
  useEffect(() => {
    void reload();
    const stop = new AbortController();
    void (async () => {
      try {
        for await (const ev of client.events(appId, 0, stop.signal)) {
          setEvents((prev) => [ev, ...prev].slice(0, 5));
          void reload();
        }
      } catch {
        // Aborted on unmount, or the stream ended; the table stays as read.
      }
    })();
    return () => stop.abort();
  }, [client, appId, reload]);

  async function run(f: () => Promise<unknown>) {
    try {
      await f();
      onError(null);
    } catch (e) {
      onError(message(e));
    }
  }

  return (
    <>
      <div className="card">
        <h2>Write</h2>
        <div className="row">
          <input placeholder="key" value={key} onChange={(e) => setKey(e.target.value)} data-testid="key" />
          <input placeholder="value" value={value} onChange={(e) => setValue(e.target.value)} data-testid="value" />
          <button disabled={!key} onClick={() => run(() => client.call(appId, "set", { key, value }))} data-testid="set">
            Set
          </button>
          <button disabled={!key} onClick={() => run(() => client.call(appId, "remove", { key }))} data-testid="remove">
            Remove
          </button>
        </div>
      </div>
      <div className="card">
        <h2>Read</h2>
        <div className="row">
          <input placeholder="key" value={readKey} onChange={(e) => setReadKey(e.target.value)} data-testid="read-key" />
          <button
            disabled={!readKey}
            onClick={() =>
              run(async () => setRead((await client.view(appId, "get", { key: readKey })).result as string | null))
            }
            data-testid="get"
          >
            Get
          </button>
        </div>
        {read !== undefined && <pre data-testid="read-result">{JSON.stringify(read)}</pre>}
      </div>
      <div className="card">
        <h2>Entries</h2>
        {Object.keys(entries).length === 0 ? (
          <p className="empty">Empty.</p>
        ) : (
          <table data-testid="entries">
            <tbody>
              {Object.entries(entries).map(([k, v]) => (
                <tr key={k}>
                  <td>{k}</td>
                  <td>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <h2>Recent events</h2>
        <ul data-testid="events">
          {events.map((ev) => (
            <li key={ev.id}>
              {ev.kind} {JSON.stringify(ev.data)}
            </li>
          ))}
        </ul>
        <button onClick={props.onClose}>Close this store</button>
      </div>
    </>
  );
}
