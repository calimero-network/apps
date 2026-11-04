import { useCallback, useEffect, useMemo, useState } from "react";
import { CalimeroError, type AppInfo, type CalimeroClient } from "@calimero-network/mero-js";
import { appSource, describeError, type KeyValueStorage } from "@calimero-apps/connect";

import { InviteCard } from "./InviteCard";
import { KvPanel } from "./KvPanel";
import { PACKAGE, kvStore } from "./kvStore";
import { SignIn } from "./SignIn";
import { StorePicker } from "./StorePicker";
import { defaultDeps, describeTarget, useSession, type SessionDeps } from "./session";
import { dropInvite, pendingInvite, selectionKey } from "./stores";

type Opened = Pick<AppInfo, "appId" | "name" | "org">;

function readSelection(storage: KeyValueStorage, key: string): Opened | null {
  try {
    const raw = storage.getItem(key);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === "object" && typeof (parsed as Opened).appId === "string") {
      return parsed as Opened;
    }
  } catch {
    /* nothing usable stored */
  }
  return null;
}

/** Calls `onChange` (at most every 200 ms) for each event of `app`, until the returned stop. */
function subscribeTo(client: CalimeroClient, app: string) {
  return (onChange: () => void) => {
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    void (async () => {
      try {
        for await (const _event of client.events(app, 0, abort.signal)) {
          clearTimeout(timer);
          timer = setTimeout(onChange, 200);
        }
      } catch {
        // Stream closed (sign-out, app left, network): the Refresh button still works.
      }
    })();
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  };
}

export function App({
  deps = defaultDeps,
  storage = globalThis.localStorage,
}: {
  deps?: SessionDeps;
  storage?: KeyValueStorage;
}) {
  // Memoised: a new object every render would reconnect every render.
  const sessionDeps = useMemo(
    () => (storage === deps.storage || !storage ? deps : { ...deps, storage }),
    [deps, storage],
  );
  const api = useSession(sessionDeps);
  const { session, store } = api;
  const source = useMemo(() => appSource(deps.env, PACKAGE), [deps.env]);
  const [opened, setOpened] = useState<Opened | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pickerKey, setPickerKey] = useState(0);

  const client = session.status === "signed-in" ? session.client : null;
  const key = session.status === "signed-in" ? selectionKey(session.target, session.accountId) : null;
  const after = useCallback(() => {
    if (client) store?.sync(client);
  }, [client, store]);

  // The store opened last time, on this target, by this account.
  useEffect(() => {
    setOpened(key ? readSelection(storage, key) : null);
  }, [key, storage]);

  const open = useCallback(
    (app: Opened | null) => {
      setOpened(app);
      if (!key) return;
      try {
        if (app) storage.setItem(key, JSON.stringify({ appId: app.appId, name: app.name, org: app.org }));
        else storage.removeItem(key);
      } catch {
        /* remembered for this page only */
      }
    },
    [key, storage],
  );

  // An invitation link opened before signing in is redeemed once a session exists.
  useEffect(() => {
    if (!client) return;
    const token = pendingInvite(storage);
    if (!token) return;
    let live = true;
    client
      .redeemInvite(token)
      .then(() => {
        dropInvite(storage);
        if (live) {
          setNotice("Invitation accepted: the shared store is in your list.");
          setPickerKey((k) => k + 1);
        }
      })
      .catch((e: unknown) => {
        // A refusal (used, expired, revoked) can never succeed: drop it. Anything
        // else (the cluster unreachable) is kept and tried on the next load.
        if (e instanceof CalimeroError && e.status < 500) dropInvite(storage);
        if (live) setNotice(`The invitation could not be accepted: ${describeError(e)}`);
      })
      .finally(after);
    return () => {
      live = false;
    };
  }, [client, storage, after]);

  const kv = useMemo(
    () => (client && opened ? kvStore(client, opened.appId, after) : null),
    [client, opened, after],
  );
  const subscribe = useMemo(() => (client && opened ? subscribeTo(client, opened.appId) : undefined), [client, opened]);

  return (
    <div className="wrap">
      <header>
        <h1>KV Store</h1>
        <p className="sub">
          The reference Calimero app: a string key-value store in a WebAssembly component, every
          write ordered by the cluster&apos;s log, called through mero-js.
        </p>
      </header>

      {session.status === "connecting" && (
        <div className="card">
          <p className="empty">Connecting…</p>
        </div>
      )}

      {session.status === "listing" && (
        <div className="card">
          <h2>Open KV Store from Calimero Cloud</h2>
          <p>
            This is kv-store&apos;s listing page, not the app: a Calimero Cloud node signs you in only on
            the copy of the app its cluster serves. Deploy kv-store and open it from{" "}
            <a href={session.console}>Calimero Cloud</a>.
          </p>
        </div>
      )}

      {session.status === "unconfigured" && (
        <div className="card">
          <h2>Cannot connect</h2>
          <pre className="err">{session.message}</pre>
        </div>
      )}

      {session.status === "signed-out" && <SignIn api={api} where={describeTarget(session.target)} />}

      {notice && (
        <div className="card">
          <p className="empty">{notice}</p>
        </div>
      )}

      {session.status === "signed-in" && !opened && (
        <StorePicker key={pickerKey} client={session.client} source={source} onOpen={open} after={after} />
      )}

      {session.status === "signed-in" && opened && kv && (
        <>
          <div className="card context-bar">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <span className="empty">
                Store <strong>{opened.name}</strong> <code className="mono">{opened.appId}</code>
              </span>
              <button className="ghost" onClick={() => open(null)}>
                Change store
              </button>
            </div>
          </div>
          <KvPanel key={opened.appId} kv={kv} subscribe={subscribe} />
          <InviteCard
            key={`invite-${opened.appId}`}
            client={session.client}
            org={opened.org}
            passkey={deps.passkey}
            after={after}
          />
        </>
      )}

      {session.status === "signed-in" && (
        <footer className="row" style={{ justifyContent: "space-between", marginTop: 24 }}>
          <span className="empty">
            {describeTarget(session.target)} · account <code className="mono">{session.accountId}</code>
          </span>
          <button className="ghost" onClick={() => void api.signOut()}>
            Sign out
          </button>
        </footer>
      )}
    </div>
  );
}
