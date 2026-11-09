import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  BrowserRouter,
  Link,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import {
  appSource,
  askAnOwnerCopy,
  canCreateIn,
  type InviteStore,
  type KeyValueStorage,
  type PendingInvite,
} from "@calimero-apps/connect";
import { AppListing, InvitationSignIn, JoinInvitation, PasskeySignIn, usePendingInvite } from "@calimero-apps/passkey";
import "@calimero-apps/passkey/passkey.css";

import { arenaIn, basename, invitedArena, invites as appInvites, listArenas, selectionKey } from "./arenas";
import { ArenaPage, type OpenArena } from "./ArenaPage";
import { PACKAGE } from "./kombat";
import { Lobby } from "./Lobby";
import { PracticePage } from "./PracticePage";
import LandingPage from "./pages/landing/LandingPage";
import { SessionProvider } from "./SessionProvider";
import {
  INVITATION_PAGE_CLASSES,
  LISTING,
  ONBOARDING,
  defaultDeps,
  describeTarget,
  useInviteState,
  useSessionApi,
  type SessionApi,
  type SessionDeps,
} from "./session";
import { shortAccount } from "./useCornerNames";

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

function readSelection(storage: KeyValueStorage, key: string): OpenArena | null {
  try {
    const raw = storage.getItem(key);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === "object" && typeof (parsed as OpenArena).appId === "string") {
      return parsed as OpenArena;
    }
  } catch {
    /* nothing usable stored */
  }
  return null;
}

/** Passkey sign-in, or a new account with a new passkey, and the way to practice without either. */
function ConnectCard({ api, where }: { api: SessionApi; where: string }) {
  return (
    <section className="connect">
      <div className="connect-card">
        <img className="connect-mark" src={`${basename()}favicon.svg`} alt="" />
        <h1>Sign in to fight</h1>
        <p className="lede">
          Mero Kombat fights through a Calimero cluster ({where}): every punch you throw is a
          transaction its log orders. Accounts are passkeys: nothing to remember, nothing to leak.
        </p>
        <div className="connect-passkey">
          <PasskeySignIn api={api} joining="the arena" />
        </div>
        <ul className="connect-points">
          <li>No game server</li>
          <li>Every blow is a transaction</li>
          <li>No passwords</li>
        </ul>
      </div>
    </section>
  );
}

/**
 * The app proper: sign in, pick an arena, fight.
 *
 * The states are exactly the things that can be missing: a cluster, a
 * session, an arena, and then nothing.
 */
function PlayPage({ storage, deps }: { storage: KeyValueStorage; deps: SessionDeps }) {
  const api = useSessionApi();
  const { session, store } = api;
  const source = useMemo(() => appSource(deps.env, PACKAGE), [deps.env]);
  const [opened, setOpened] = useState<OpenArena | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [lobbyKey, setLobbyKey] = useState(0);

  const client = session.status === "signed-in" ? session.client : null;
  const key = session.status === "signed-in" ? selectionKey(session.target, session.accountId) : null;
  const after = useCallback(() => {
    if (client) store?.sync(client);
  }, [client, store]);

  // The arena opened last time, on this target, by this account.
  useEffect(() => {
    setOpened(key ? readSelection(storage, key) : null);
  }, [key, storage]);

  const open = useCallback(
    (arena: OpenArena | null) => {
      setOpened(arena);
      if (!key) return;
      try {
        if (arena) storage.setItem(key, JSON.stringify(arena));
        else storage.removeItem(key);
      } catch {
        /* remembered for this page only */
      }
    },
    [key, storage],
  );

  // An invitation link opened before signing in: a page of its own while it
  // is pending (the shared `InvitationSignIn`), redeemed only on "Join", after
  // which the arena it names is opened. A sign-up from that page joined with
  // the invite already (`SessionProvider` sets `landing`): the arena opens
  // straight away.
  const { invites, landing, setLanding } = useInviteState();
  const pending = usePendingInvite(invites);
  // The invitation a signed-in account is asked about stays on screen until it
  // closes: `JoinInvitation` drops the token before it says "already in" or
  // "used up", and the store would take the page away with it.
  const [asked, setAsked] = useState<PendingInvite | null>(null);
  useEffect(() => {
    if (!client) setAsked(null);
    else if (pending) setAsked(pending);
  }, [client, pending]);
  const invite = client ? (pending ?? asked) : null;

  // Where an invite landed: the arena its link named, else one in the org it
  // joined (or the account was already in), once there is a client to list
  // them with.
  useEffect(() => {
    if (!client || !landing) return;
    setLanding(null);
    const { org, arena: named } = landing;
    void (async () => {
      setLobbyKey((k) => k + 1);
      const remembered = key ? readSelection(storage, key)?.appId : null;
      const found = arenaIn(await listArenas(client, source).catch(() => []), org, named, remembered);
      after();
      if (found) {
        open({ appId: found.appId, name: found.name, org: found.org });
        setNotice(null);
        return;
      }
      open(null);
      // In the org, but with no arena there to open: say who may add one.
      const may = org ? await canCreateIn(client, org) : null;
      setNotice(may === false ? askAnOwnerCopy("an arena") : "Invitation accepted: the arena is in your list.");
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

  if (session.status === "unconfigured" || session.status === "listing") {
    return (
      <section className="connect">
        <div className="connect-card">
          {session.status === "listing" ? (
            <AppListing {...LISTING} />
          ) : (
            <>
              <h1>Cannot connect</h1>
              <pre className="err">{session.message}</pre>
            </>
          )}
          <div className="row center">
            <Link className="button-link ghost" to="/practice">
              Practice vs CPU
            </Link>
          </div>
        </div>
      </section>
    );
  }

  if (session.status === "signed-out") {
    return <ConnectCard api={api} where={describeTarget(session.target)} />;
  }

  if (invite) {
    return (
      <JoinInvitation
        {...ONBOARDING}
        key={invite.token}
        client={session.client}
        token={invite.token}
        org={invite.org}
        drop={invites.drop}
        after={after}
        onJoined={({ org }) => {
          setAsked(null);
          setLanding({ org, arena: invitedArena(invite) });
        }}
        onClose={({ member }) => {
          setAsked(null);
          if (member) setLanding({ org: member, arena: invitedArena(invite) });
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
        // Keyed, so opening another arena starts from a fresh read.
        <ArenaPage
          key={opened.appId}
          client={session.client}
          arena={opened}
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

/**
 * A signed-out visitor holding an invite (`?invite=`, taken into storage by
 * `main.tsx`) sees the invitation page instead of whatever the route would
 * render (the landing page, or the play page's sign-in). The route is left
 * alone: signing in there keeps it, and the play page asks to join (from `/`,
 * `RedirectIfAuthed` goes there first). "Not now" goes to the landing page and
 * keeps the token.
 */
function InvitationGate({ children }: { children: ReactNode }) {
  const api = useSessionApi();
  const pending = usePendingInvite(useInviteState().invites);
  const navigate = useNavigate();
  const [later, setLater] = useState(false);
  const { session } = api;
  if (later || session.status !== "signed-out" || pending === null) return <>{children}</>;
  return (
    <AppShell>
      <InvitationSignIn
        {...ONBOARDING}
        classNames={INVITATION_PAGE_CLASSES}
        titleAs="h1"
        api={api}
        onLater={() => {
          setLater(true);
          navigate("/");
        }}
      />
    </AppShell>
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
            <span>Mero Kombat</span>
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
        <InvitationGate>
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
            {/* Practice needs no cluster: the CPU lives in this tab. */}
            <Route
              path="/practice"
              element={
                <AppShell>
                  <PracticePage />
                </AppShell>
              }
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </InvitationGate>
      </BrowserRouter>
    </SessionProvider>
  );
}
