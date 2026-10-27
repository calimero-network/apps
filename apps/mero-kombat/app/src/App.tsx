import { useCallback, useState, type ReactNode } from "react";
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
  ConnectButton,
  InvitationDialog,
  InvitationGate,
  useMero,
} from "@calimero-apps/cloud";
import { ContextPicker } from "./ContextPicker";
import { ArenaPage } from "./ArenaPage";
import { PracticePage } from "./PracticePage";
import { readInvitation, useJoinFromInvitation } from "./useJoinFromInvitation";
import LandingPage from "./pages/landing/LandingPage";
import { nodeBasename } from "@calimero-apps/node-served";

const basename = () => nodeBasename(new URL(window.location.href), "/");

/** Every path the shared landing page serves. See src/pages/landing. */
const LANDING_PATHS = ["/", "/docs", "/preview"];

/**
 * The landing page, told who is looking at it.
 *
 * ⚠️ `useMero()` lives HERE, not in `LandingPage`. That component is generated
 * from a template shared by the whole fleet, and some apps render it with no
 * `MeroProvider` above them — the hook would throw for those. So the app, which
 * knows it has a provider, reads the session and hands the answer down.
 */
function AppLandingPage() {
  const { isAuthenticated } = useMero();
  const navigate = useNavigate();
  return (
    <LandingPage
      isAuthenticated={isAuthenticated}
      onOpenApp={() => navigate("/play")}
    />
  );
}

/**
 * An authenticated visitor has no business on the marketing page.
 *
 * ⚠️ THIS IS THE STEP THAT CARRIES YOU INTO THE APP. The SSO callback returns
 * to wherever login started — `connectToNode` uses `window.location.href` as
 * the callback URL — which for a visitor who pressed Connect on the landing
 * page is `/`. Without this guard the tokens land, `isAuthenticated` flips
 * true, and the router renders the landing page again: you log in successfully
 * and end up exactly where you started.
 */
function RedirectIfAuthed({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useMero();
  const location = useLocation();
  // Asking for the landing page ON PURPOSE — the in-app link back to it — is
  // not the case this guard exists for, so it is let through.
  //
  // ⚠️ ROUTER STATE, deliberately, not a query parameter. State lives in the
  // history entry and never survives a fresh document load, so the SSO callback
  // — which arrives as a cold navigation to `/` — cannot carry it even if the
  // URL it returns to was captured from a page that had it.
  const deliberate =
    (location.state as { fromApp?: boolean } | null)?.fromApp === true;
  if (isLoading) return null; // the auth probe is still in flight
  if (isAuthenticated && !deliberate) return <Navigate to="/play" replace />;
  return <>{children}</>;
}

/**
 * The app proper: connect, pick an arena, fight.
 *
 * The three states are exactly the three things that can be missing — a
 * session, a context, and then nothing.
 */
function PlayPage({ joinedContextId }: { joinedContextId: string | null }) {
  const {
    isAuthenticated,
    isLoading,
    applicationId,
    contextId: storedContextId,
  } = useMero();
  // An arena an invitation just joined wins over the stored one: it is opened
  // in place (see `InvitationPrompt`), and is the stored one too from the next
  // load.
  const contextId = joinedContextId ?? storedContextId;

  if (isLoading) {
    return (
      <div className="loading-state">
        <span className="spinner" aria-hidden="true" />
        <p className="empty">Connecting…</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <section className="connect">
        <div className="connect-card">
          <img className="connect-mark" src={`${basename()}favicon.svg`} alt="" />
          <h1>Connect a node</h1>
          <p className="lede">
            Mero Kombat fights through your own Calimero node — every punch you
            throw is a transaction it executes. The login modal finds a node on
            the usual local ports, and accepts a URL directly.
          </p>
          <div className="row center">
            <ConnectButton />
            <Link className="button-link ghost" to="/practice">
              Practice vs CPU
            </Link>
          </div>
          <ul className="connect-points">
            <li>No game server</li>
            <li>Every blow is a transaction</li>
            <li>No accounts</li>
          </ul>
        </div>
      </section>
    );
  }

  if (!contextId) {
    return <ContextPicker applicationId={applicationId} />;
  }

  // Keyed, so joining another arena starts from a fresh read rather than
  // counting the previous arena's view as the joined one's.
  return <ArenaPage key={contextId} contextId={contextId} />;
}

/** `head…tail`, so two ids can be told apart without the full 44 characters. */
function shortId(id: string) {
  return id.length > 16 ? `${id.slice(0, 8)}…${id.slice(-6)}` : id;
}

/**
 * The invitation prompt, above every route: mero-react's `InvitationDialog`.
 *
 * Mounted once, outside `<Routes>`, so it is never unmounted by navigation and
 * a link opened on any page — the landing page, practice, mid-fight — reaches
 * it. The hook joins only once there is a session; until then the captured
 * invitation waits (it survives the login round-trip).
 *
 * Joining opens the arena in place on `/play`, rather than storing it and
 * reloading: a reload would take the dialog down while it is still on
 * "Syncing…", which lasts until `ArenaPage` has read the joined arena.
 */
function InvitationPrompt({ onOpen }: { onOpen: (contextId: string) => void }) {
  const navigate = useNavigate();
  const join = useJoinFromInvitation(
    useCallback(
      (contextId: string) => {
        onOpen(contextId);
        navigate("/play");
      },
      [onOpen, navigate],
    ),
  );
  const invited = join.parsed;
  return (
    <>
      {/* Logged out with a link opened: "you're invited" and the login, not the landing page. */}
      <InvitationGate parse={readInvitation} noun="arena" appName="Mero Kombat" />
      <InvitationDialog
        redemption={join}
        noun="arena"
        appName="Mero Kombat"
        // The ids, because following a link must not act on the player's
        // behalf: joining binds their identity to a namespace someone else chose
        // and switches the arena they are in.
        detail={
          invited
            ? `Joining adds this node to namespace ${shortId(invited.namespaceId)} and opens its arena ${shortId(invited.contextId)}.`
            : undefined
        }
      />
    </>
  );
}

function AppShell({
  children,
  joinedContextId = null,
}: {
  children?: ReactNode;
  joinedContextId?: string | null;
}) {
  const { isAuthenticated, nodeUrl, logout } = useMero();
  const navigate = useNavigate();
  return (
    <div className="shell">
      <header className="topbar">
        <div className="topbar-inner">
          <button
            type="button"
            className="brand"
            // `state.fromApp` is what lets the logo reach the marketing page
            // without `RedirectIfAuthed` bouncing a signed-in player straight
            // back. See the guard for why this is router state and not a query.
            onClick={() => navigate("/", { state: { fromApp: true } })}
          >
            <img src={`${basename()}favicon.svg`} alt="" width={28} height={28} />
            <span>Mero Kombat</span>
          </button>
          {isAuthenticated && (
            <div className="session">
              <span className="node-pill" title={nodeUrl ?? ""}>
                <span className="presence online" aria-hidden="true" />
                <span className="mono">{nodeUrl ?? ""}</span>
              </span>
              <button className="ghost small" onClick={logout}>
                Log out
              </button>
            </div>
          )}
        </div>
      </header>
      <main className="wrap">{children ?? <PlayPage joinedContextId={joinedContextId} />}</main>
    </div>
  );
}

export function App() {
  const [joinedContextId, setJoinedContextId] = useState<string | null>(null);
  return (
    <BrowserRouter basename={basename()}>
      <InvitationPrompt onOpen={setJoinedContextId} />
      <Routes>
        {/* The landing page is three pages: `/`, `/docs` and `/preview`. They
            are real URLs so they can be shared and opened cold, which needs a
            route here — otherwise the catch-all below swallows the deep link
            before the page ever renders. */}
        {LANDING_PATHS.map((path) => (
          <Route
            key={path}
            path={path}
            // ⚠️ Only `/` bounces a signed-in visitor into the app. `/docs` and
            // `/preview` are reference pages, and somebody already signed in is
            // exactly the person most likely to want to read them.
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
          element={<AppShell joinedContextId={joinedContextId} />}
        />
        {/* Practice needs no node: the CPU lives in this tab. */}
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
    </BrowserRouter>
  );
}
