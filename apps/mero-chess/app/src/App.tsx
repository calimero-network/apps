import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { CalimeroError } from "@calimero-network/mero-js";
import { appSource, type KeyValueStorage } from "@calimero-apps/connect";
import { nodeBasename } from "@calimero-apps/node-served";
import { PasskeySignIn } from "@calimero-apps/passkey";
import "@calimero-apps/passkey/passkey.css";

import { PACKAGE, messageOf } from "./chess";
import { Lobby } from "./Lobby";
import LandingPage from "./pages/landing/LandingPage";
import { SessionProvider } from "./SessionProvider";
import {
  defaultDeps,
  describeTarget,
  useSessionApi,
  type SessionApi,
  type SessionDeps,
} from "./session";
import { TablePage, type OpenTable } from "./TablePage";
import { dropInvite, pendingInvite, selectionKey } from "./tables";
import { shortAccount } from "./useSeatNames";

const basename = () => nodeBasename(new URL(window.location.href), "/");

/** Every path the shared landing page serves. See src/pages/landing. */
const LANDING_PATHS = ["/", "/docs", "/preview"];

/** The landing page, told who is looking at it. */
function AppLandingPage() {
  const { session } = useSessionApi();
  const navigate = useNavigate();
  return (
    <LandingPage
      isAuthenticated={session.status === "signed-in"}
      onOpenApp={() => navigate("/play")}
      // Sign-in is a passkey on the play page: there is no login popup.
      onConnect={() => navigate("/play")}
    />
  );
}

/**
 * A signed-in visitor has no business on the marketing page: `/` sends them
 * into the app. Asking for the landing page ON PURPOSE (the logo, which sets
 * router state `fromApp`) is let through.
 */
function RedirectIfAuthed({ children }: { children: ReactNode }) {
  const { session } = useSessionApi();
  const location = useLocation();
  const deliberate = (location.state as { fromApp?: boolean } | null)?.fromApp === true;
  if (session.status === "connecting") return null;
  if (session.status === "signed-in" && !deliberate) return <Navigate to="/play" replace />;
  return <>{children}</>;
}

function readSelection(storage: KeyValueStorage, key: string): OpenTable | null {
  try {
    const raw = storage.getItem(key);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === "object" && typeof (parsed as OpenTable).appId === "string") {
      return parsed as OpenTable;
    }
  } catch {
    /* nothing usable stored */
  }
  return null;
}

/** Passkey sign-in, or a new account with a new passkey. */
function ConnectCard({ api, where }: { api: SessionApi; where: string }) {
  return (
    <section className="connect">
      <div className="connect-card">
        <img className="connect-mark" src={`${basename()}favicon.svg`} alt="" />
        <h1>Sign in to play</h1>
        <p className="lede">
          Mero Chess plays through a Calimero cluster ({where}): every move is a transaction its
          log orders, refereed by the contract. Accounts are passkeys: nothing to remember, nothing
          to leak.
        </p>
        <div className="connect-passkey">
          <PasskeySignIn api={api} />
        </div>
        <ul className="connect-points">
          <li>No game server</li>
          <li>Rules run in the contract</li>
          <li>No passwords</li>
        </ul>
      </div>
    </section>
  );
}

/**
 * The app proper: sign in, pick a table, play.
 *
 * The states are exactly the things that can be missing: a cluster, a
 * session, a table, and then nothing.
 */
function PlayPage({ storage, deps }: { storage: KeyValueStorage; deps: SessionDeps }) {
  const api = useSessionApi();
  const { session, store } = api;
  const source = useMemo(() => appSource(deps.env, PACKAGE), [deps.env]);
  const [opened, setOpened] = useState<OpenTable | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [lobbyKey, setLobbyKey] = useState(0);

  const client = session.status === "signed-in" ? session.client : null;
  const key = session.status === "signed-in" ? selectionKey(session.target, session.accountId) : null;
  const after = useCallback(() => {
    if (client) store?.sync(client);
  }, [client, store]);

  // The table opened last time, on this target, by this account.
  useEffect(() => {
    setOpened(key ? readSelection(storage, key) : null);
  }, [key, storage]);

  const open = useCallback(
    (table: OpenTable | null) => {
      setOpened(table);
      if (!key) return;
      try {
        if (table) storage.setItem(key, JSON.stringify(table));
        else storage.removeItem(key);
      } catch {
        /* remembered for this page only */
      }
    },
    [key, storage],
  );

  // An invitation link opened before signing in is redeemed once a session
  // exists, and the table it names is opened.
  useEffect(() => {
    if (!client) return;
    const invite = pendingInvite(storage);
    if (!invite) return;
    let live = true;
    client
      .redeemInvite(invite.token)
      .then(async () => {
        dropInvite(storage);
        if (!live) return;
        setLobbyKey((k) => k + 1);
        const table = invite.table
          ? (await client.listApps({}).catch(() => [])).find((a) => a.appId === invite.table)
          : undefined;
        if (!live) return;
        if (table) {
          open({ appId: table.appId, name: table.name, org: table.org });
          setNotice(null);
        } else {
          setNotice("Invitation accepted: the table is in your list.");
        }
      })
      .catch((e: unknown) => {
        // A refusal (used, expired, revoked) can never succeed: drop it.
        // Anything else (the cluster unreachable) is kept for the next load.
        if (e instanceof CalimeroError && e.status < 500) dropInvite(storage);
        if (live) setNotice(`The invitation could not be accepted: ${messageOf(e)}`);
      })
      .finally(after);
    return () => {
      live = false;
    };
  }, [client, storage, after, open]);

  if (session.status === "connecting") {
    return (
      <div className="loading-state">
        <span className="spinner" aria-hidden="true" />
        <p className="empty">Connecting…</p>
      </div>
    );
  }

  if (session.status === "unconfigured") {
    return (
      <section className="connect">
        <div className="connect-card">
          <h1>Cannot connect</h1>
          <pre className="err">{session.message}</pre>
        </div>
      </section>
    );
  }

  if (session.status === "signed-out") {
    return <ConnectCard api={api} where={describeTarget(session.target)} />;
  }

  return (
    <>
      {notice && (
        <div className="card alert" role="status">
          <p className="empty">{notice}</p>
          <button className="ghost small" onClick={() => setNotice(null)}>
            Dismiss
          </button>
        </div>
      )}
      {opened ? (
        // Keyed, so opening another table starts from a fresh read.
        <TablePage
          key={opened.appId}
          client={session.client}
          table={opened}
          after={after}
          passkey={deps.passkey}
          onLeave={() => open(null)}
        />
      ) : (
        <Lobby key={lobbyKey} client={session.client} source={source} onOpen={open} after={after} />
      )}
    </>
  );
}

function AppShell({ children }: { children: ReactNode }) {
  const { session, signOut } = useSessionApi();
  const navigate = useNavigate();
  return (
    <div className="shell">
      <header className="topbar">
        <div className="topbar-inner">
          <button
            type="button"
            className="brand"
            // `state.fromApp` is what lets the logo reach the marketing page
            // without `RedirectIfAuthed` bouncing a signed-in player back.
            onClick={() => navigate("/", { state: { fromApp: true } })}
          >
            <img src={`${basename()}favicon.svg`} alt="" width={28} height={28} />
            <span>Mero Chess</span>
          </button>
          {session.status === "signed-in" && (
            <div className="session">
              <span className="node-pill" title={`${describeTarget(session.target)} · ${session.accountId}`}>
                <span className="presence online" aria-hidden="true" />
                <span className="mono">
                  {describeTarget(session.target)} · {shortAccount(session.accountId)}
                </span>
              </span>
              <button className="ghost small" onClick={() => void signOut()}>
                Log out
              </button>
            </div>
          )}
        </div>
      </header>
      <main className="wrap">{children}</main>
    </div>
  );
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
  return (
    <SessionProvider deps={sessionDeps}>
      <BrowserRouter basename={basename()}>
        <Routes>
          {/* The landing page is three pages: `/`, `/docs` and `/preview`. They
              are real URLs so they can be shared and opened cold. */}
          {LANDING_PATHS.map((path) => (
            <Route
              key={path}
              path={path}
              // Only `/` bounces a signed-in visitor into the app.
              element={
                path === "/" ? (
                  <RedirectIfAuthed>
                    <AppLandingPage />
                  </RedirectIfAuthed>
                ) : (
                  <AppLandingPage />
                )
              }
            />
          ))}
          <Route
            path="/play"
            element={
              <AppShell>
                <PlayPage storage={storage} deps={sessionDeps} />
              </AppShell>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </SessionProvider>
  );
}
