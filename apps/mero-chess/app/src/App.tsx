import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { appSource, type InviteStore, type KeyValueStorage } from "@calimero-apps/connect";
import { AppListing, JoinInvitation, PasskeySignIn, useInstanceRelease, usePendingInvite, useAskedInvite } from "@calimero-apps/passkey";
import "@calimero-apps/passkey/passkey.css";

import { PACKAGE } from "./chess";
import { Lobby } from "./Lobby";
import LandingPage from "./pages/landing/LandingPage";
import { SessionProvider } from "./SessionProvider";
import {
  LISTING,
  ONBOARDING,
  defaultDeps,
  describeTarget,
  useInviteState,
  useSessionApi,
  type SessionApi,
  type SessionDeps,
} from "./session";
import { TablePage, type OpenTable } from "./TablePage";
import {
  basename,
  deferInvite,
  inviteDeferred,
  invitedTable,
  inviter,
  invites as appInvites,
  listTables,
  selectionKey,
  tableIn,
} from "./tables";
import { shortAccount } from "./useSeatNames";

/** Every path the shared landing page serves. See src/pages/landing. */
const LANDING_PATHS = ["/", "/docs", "/preview"];

/**
 * The landing page, told who is looking at it.
 *
 * Signed out with an invitation waiting, the invitation is the page: the
 * passkey sign-in on `/play`, worded as the invitation, with no landing hero
 * in front of it. Its "Not now" comes back here, keeping the token.
 */
function AppLandingPage() {
  const { session } = useSessionApi();
  const pending = usePendingInvite(useInviteState().invites);
  const navigate = useNavigate();
  if (session.status === "signed-out" && !inviteDeferred() && pending) {
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
  // A table is an app instance, served the frontend of the release it runs.
  useInstanceRelease(client, opened?.appId);
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

  // An invitation is asked about, never redeemed on its own: "Join {inviter}'s
  // game as {account}?", with Join and Not now. Joining opens the table the
  // link named (else one in the org it joined). A sign-up from the invitation
  // page joined with the invite already (`SessionProvider` sets `landing`), and
  // its table opens straight away.
  const { invites, landing, setLanding } = useInviteState();
  const pending = usePendingInvite(invites);
  // The invitation a signed-in account is asked about stays on screen until it
  // closes: `JoinInvitation` drops the token before it says "already in" or
  // "used up", and the store would take the question away with it.
  const { invite, close: closeInvite } = useAskedInvite(invites, !!client);
  // The token checked against the tables this account reaches already.
  const [checked, setChecked] = useState<string | null>(null);

  // ⚠️ Not asked of someone who already reaches the table the link names:
  // redeeming spends the link's single use, so the owner trying their own link
  // used to leave the opponent it was meant for with "unknown invite". The
  // table opens and the token is dropped unspent.
  const pendingToken = pending?.token ?? null;
  const pendingTable = invitedTable(pending);
  useEffect(() => {
    if (!client || !pendingToken) return;
    if (!pendingTable) {
      setChecked(pendingToken);
      return;
    }
    let live = true;
    void client.apps.list({}).then((r) => r.apps)
      .then(
        (apps) => apps.find((a) => a.appId === pendingTable) ?? null,
        () => null,
      )
      .then((table) => {
        if (!live) return;
        if (table) {
          invites.drop();
          closeInvite();
          open({ appId: table.appId, name: table.name, org: table.org });
          setNotice(
            "You already reach this table, so there was nothing to accept. The link is left unused for the person it was meant for.",
          );
        }
        setChecked(pendingToken);
      })
      .finally(after);
    return () => {
      live = false;
    };
  }, [client, pendingToken, pendingTable, invites, open, after, closeInvite]);

  // Where an invite landed: the table its link named, else one in the org it
  // joined (or the account was already in), once there is a client to list
  // them with.
  useEffect(() => {
    if (!client || !landing) return;
    setLanding(null);
    const { org, table: named } = landing;
    void (async () => {
      setLobbyKey((k) => k + 1);
      const remembered = key ? readSelection(storage, key)?.appId : null;
      const found = tableIn(await listTables(client, source).catch(() => []), org, named, remembered);
      after();
      if (found) {
        open({ appId: found.appId, name: found.name, org: found.org });
        setNotice(null);
        return;
      }
      open(null);
      setNotice("Invitation accepted: the table is in your list.");
    })();
  }, [client, landing, setLanding, source, key, storage, after, open]);

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
        invited={pending !== null}
        onNotNow={() => {
          deferInvite();
          navigate("/");
        }}
      />
    );
  }

  if (invite) {
    if (checked !== invite.token) {
      return (
        <div className="loading-state">
          <span className="spinner" aria-hidden="true" />
          <p className="empty">Reading the invitation…</p>
        </div>
      );
    }
    const from = inviter(invite);
    return (
      <JoinInvitation
        {...ONBOARDING}
        key={invite.token}
        joining={from ? `${from}'s game` : "the game"}
        account={shortAccount(session.accountId)}
        client={session.client}
        token={invite.token}
        org={invite.org}
        drop={invites.drop}
        after={after}
        onJoined={({ org }) => {
          closeInvite();
          setLanding({ org, table: invitedTable(invite) });
        }}
        onClose={({ member }) => {
          closeInvite();
          if (member) setLanding({ org: member, table: invitedTable(invite) });
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
  invites = appInvites,
}: {
  deps?: SessionDeps;
  storage?: KeyValueStorage;
  /** The pending-invite store; the module's own unless a test passes one. */
  invites?: InviteStore;
}) {
  // Memoised: a new object every render would reconnect every render.
  const sessionDeps = useMemo(
    () => (storage === deps.storage || !storage ? deps : { ...deps, storage }),
    [deps, storage],
  );
  return (
    <SessionProvider deps={sessionDeps} invites={invites}>
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
