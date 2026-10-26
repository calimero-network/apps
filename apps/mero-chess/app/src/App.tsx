import { useEffect, useState, type ReactNode } from "react";
import {
  BrowserRouter,
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
} from "@calimero-network/mero-react";
import { ContextPicker } from "./ContextPicker";
import { TablePage } from "./TablePage";
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
 * The app proper: connect, pick a table, play.
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
  // A table an invitation just joined wins over the stored one: it is opened
  // in place (see `AppRoutes`), and is the stored one too from the next load.
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
            Mero Chess plays through your own Calimero node. The login modal
            finds one on the usual local ports, and accepts a URL directly.
          </p>
          <ConnectButton />
          <ul className="connect-points">
            <li>No game server</li>
            <li>Rules run in the contract</li>
            <li>No accounts</li>
          </ul>
        </div>
      </section>
    );
  }

  if (!contextId) {
    return (
      <ContextPicker applicationId={applicationId}>
        {/* An invitation reaches this app only by its link being opened, so
            there is nothing to paste: this says where one comes from, and the
            invitation dialog asks once a link has been opened. */}
        <div className="card join-card">
          <div className="card-head">
            <h2>Join with an invitation</h2>
          </div>
          <p className="hint">
            Open an invitation link someone sent you. It opens this app and asks
            before joining.
          </p>
        </div>
      </ContextPicker>
    );
  }

  // Keyed, so joining another table starts from a fresh read rather than
  // counting the previous table's view as the joined one's.
  return <TablePage key={contextId} contextId={contextId} />;
}

function AppShell({ joinedContextId }: { joinedContextId: string | null }) {
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
            <span>Mero Chess</span>
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
      <main className="wrap">
        <PlayPage joinedContextId={joinedContextId} />
      </main>
    </div>
  );
}

/** `head…tail`, so two ids can be told apart without the full 44 characters. */
function shortId(id: string) {
  return id.length > 16 ? `${id.slice(0, 8)}…${id.slice(-6)}` : id;
}

export function App() {
  return (
    <BrowserRouter basename={basename()}>
      <AppRoutes />
    </BrowserRouter>
  );
}

function AppRoutes() {
  // Above the routes, unconditionally: an invitation captured before login has
  // to be offered as soon as the session exists, and a link can be opened on
  // any page — the landing page, the docs, or mid-game.
  //
  // The joined table is opened in place, not by storing it and reloading as
  // the picker does: a reload would take the invitation dialog down while it
  // is still waiting for the table to arrive.
  const [joinedContextId, setJoinedContextId] = useState<string | null>(null);
  const join = useJoinFromInvitation(setJoinedContextId);
  const invited = join.parsed;
  const navigate = useNavigate();
  const { pathname } = useLocation();
  // A join lands on the play page, so an invitation that surfaces anywhere
  // else takes the player there, where the table fills in behind the dialog.
  const pending = join.state.stage !== "idle";
  useEffect(() => {
    if (pending && pathname !== "/play") navigate("/play");
  }, [pending, pathname, navigate]);

  return (
    <>
      {/* Logged out with a link opened: "you're invited" and the login, not the landing page. */}
      <InvitationGate parse={readInvitation} noun="table" appName="Mero Chess" />
      {/* Above the routes, so a link opened mid-game is asked about too. It
          stays on "Syncing…" until `TablePage` has read the joined table. The
          ids are shown because following a link must not act on the player's
          behalf: joining binds their identity to a namespace someone else
          chose and switches the table they are at. */}
      <InvitationDialog
        redemption={join}
        noun="table"
        appName="Mero Chess"
        detail={
          invited
            ? `Joining adds this node to namespace ${shortId(invited.namespaceId)} and opens its table ${shortId(invited.contextId)}.`
            : undefined
        }
      />
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
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}
