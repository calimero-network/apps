import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { appSource, type KeyValueStorage } from "@calimero-apps/connect";
import { nodeBasename } from "@calimero-apps/node-served";
import { AppListing, PasskeySignIn } from "@calimero-apps/passkey";
import "@calimero-apps/passkey/passkey.css";

import { PACKAGE, messageOf } from "./chess";
import { Lobby } from "./Lobby";
import LandingPage from "./pages/landing/LandingPage";
import { SessionProvider } from "./SessionProvider";
import {
  LISTING,
  defaultDeps,
  describeTarget,
  useSessionApi,
  type SessionApi,
  type SessionDeps,
} from "./session";
import { TablePage, type OpenTable } from "./TablePage";
import {
  SPENT_INVITE,
  deferInvite,
  dropInvite,
  inviteDeferred,
  inviteRefused,
  pendingInvite,
  selectionKey,
} from "./tables";
import { shortAccount } from "./useSeatNames";

const basename = () => nodeBasename(new URL(window.location.href), "/");

/** Every path the shared landing page serves. See src/pages/landing. */
const LANDING_PATHS = ["/", "/docs", "/preview"];

/**
 * The landing page, told who is looking at it.
 *
 * Signed out with an invitation waiting, the invitation is the page: the
 * passkey sign-in on `/play`, worded as the invitation, with no landing hero
 * in front of it. Its "Not now" comes back here, keeping the token.
 */
function AppLandingPage({ storage }: { storage: KeyValueStorage }) {
  const { session } = useSessionApi();
  const navigate = useNavigate();
  if (session.status === "signed-out" && !inviteDeferred() && pendingInvite(storage)) {
    return <Navigate to="/play" replace />;
  }
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

/**
 * Passkey sign-in, or a new account with a new passkey. With an invitation
 * waiting it is the invitation page: the same sign-in, worded as the
 * invitation, and a "Not now" that keeps the token.
 */
function ConnectCard({
  api,
  where,
  invited,
  onNotNow,
}: {
  api: SessionApi;
  where: string;
  invited: boolean;
  onNotNow: () => void;
}) {
  return (
    <section className="connect" data-testid={invited ? "invitation-page" : undefined}>
      <div className="connect-card">
        <img className="connect-mark" src={`${basename()}favicon.svg`} alt="" />
        <h1>{invited ? "You're invited" : "Sign in to play"}</h1>
        <p className="lede" data-testid="signin-desc">
          {invited
            ? "You've been invited to join the table in Mero Chess. "
            : ""}
          Mero Chess plays through a Calimero cluster ({where}): every move is a transaction its
          log orders, refereed by the contract. Accounts are passkeys: nothing to remember, nothing
          to leak.
        </p>
        <div className="connect-passkey">
          <PasskeySignIn api={api} joining="the table" invited={invited} />
        </div>
        {invited && (
          <button
            type="button"
            className="ghost small"
            onClick={onNotNow}
            disabled={api.busy}
            data-testid="invitation-not-now"
          >
            Not now
          </button>
        )}
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
  const navigate = useNavigate();
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
  //
  // ⚠️ Not by someone who already reaches that table: redeeming spends the
  // link's single use, so the owner trying their own link used to leave the
  // opponent it was meant for with "unknown invite". The table is opened and
  // the token dropped unspent.
  useEffect(() => {
    if (!client) return;
    const invite = pendingInvite(storage);
    if (!invite) return;
    let live = true;
    const redeem = () =>
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
          // A refusal (unknown, used, expired, revoked) can never succeed:
          // drop it and say so plainly. Anything else (the cluster
          // unreachable) is kept for the next load.
          if (inviteRefused(e)) {
            dropInvite(storage);
            if (live) setNotice(SPENT_INVITE);
          } else if (live) setNotice(`The invitation could not be accepted: ${messageOf(e)}`);
        });
    const reached = invite.table
      ? client.listApps({}).then(
          (apps) => apps.find((a) => a.appId === invite.table) ?? null,
          () => null,
        )
      : Promise.resolve(null);
    // A sign-up from the invitation page joined with the invite already.
    const joined = api.joinedInvite === invite.token;
    void reached
      .then((table) => {
        if (!table && !joined) return redeem();
        dropInvite(storage);
        if (!live) return;
        setLobbyKey((k) => k + 1);
        if (!table) {
          setNotice("Invitation accepted: the table is in your list.");
          return;
        }
        open({ appId: table.appId, name: table.name, org: table.org });
        setNotice(
          joined
            ? null
            : "You already reach this table, so there was nothing to accept. The link is left unused for the person it was meant for.",
        );
      })
      .finally(after);
    return () => {
      live = false;
    };
    // `api.joinedInvite` is set before the session is signed in, so it is
    // current when `client` changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, storage, after, open]);

  if (session.status === "connecting") {
    return (
      <div className="loading-state">
        <span className="spinner" aria-hidden="true" />
        <p className="empty">Connecting…</p>
      </div>
    );
  }

  if (session.status === "listing") {
    return (
      <section className="connect">
        <div className="connect-card">
          <AppListing {...LISTING} />
        </div>
      </section>
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
    return (
      <ConnectCard
        api={api}
        where={describeTarget(session.target)}
        invited={pendingInvite(storage) !== null}
        onNotNow={() => {
          deferInvite();
          navigate("/");
        }}
      />
    );
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
                    <AppLandingPage storage={storage} />
                  </RedirectIfAuthed>
                ) : (
                  <AppLandingPage storage={storage} />
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
