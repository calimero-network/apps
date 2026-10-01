import type { ReactNode } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { ConnectButton, useMero } from "@calimero-network/mero-react";
import { ContextPicker } from "./ContextPicker";
import { JoinCard } from "./JoinCard";
import { TablePage } from "./TablePage";
import { useJoinFromInvitation } from "./useJoinFromInvitation";
import LandingPage from "./pages/landing/LandingPage";

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
  return <LandingPage isAuthenticated={isAuthenticated} onOpenApp={() => navigate("/play")} />;
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
  const deliberate = (location.state as { fromApp?: boolean } | null)?.fromApp === true;
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
function PlayPage() {
  const { isAuthenticated, isLoading, applicationId, contextId } = useMero();
  // Mounted unconditionally: an invitation captured before login has to be
  // redeemed as soon as the session exists, which means it cannot live inside a
  // branch that only renders once a table is open.
  const { state: joinState, redeemPasted, confirmJoin, declineJoin } = useJoinFromInvitation();

  if (isLoading) {
    return (
      <div className="card">
        <p className="empty">Connecting…</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="card">
        <h2>Connect a node</h2>
        <p className="empty" style={{ marginBottom: 14 }}>
          Mero Chess plays through your own Calimero node. The login modal finds
          one on the usual local ports, and accepts a URL directly.
        </p>
        <ConnectButton />
      </div>
    );
  }

  if (!contextId) {
    return (
      <>
        <ContextPicker applicationId={applicationId} />
        <JoinCard
          state={joinState}
          onSubmit={redeemPasted}
          onConfirm={confirmJoin}
          onDecline={declineJoin}
        />
      </>
    );
  }

  return (
    <>
      {/* A link can arrive while a table is already open, and the prompt has to
          be reachable then too — otherwise an invitation received mid-game
          waits silently until the player happens to log out. */}
      {joinState.status !== "idle" && (
        <JoinCard
          state={joinState}
          onSubmit={redeemPasted}
          onConfirm={confirmJoin}
          onDecline={declineJoin}
        />
      )}
      <TablePage contextId={contextId} />
    </>
  );
}

function AppShell() {
  const { isAuthenticated, nodeUrl, logout } = useMero();
  const navigate = useNavigate();
  return (
    <div className="wrap">
      <header>
        <button
          type="button"
          className="brand"
          // `state.fromApp` is what lets the logo reach the marketing page
          // without `RedirectIfAuthed` bouncing a signed-in player straight
          // back. See the guard for why this is router state and not a query.
          onClick={() => navigate("/", { state: { fromApp: true } })}
        >
          <span aria-hidden="true">♞</span> Mero Chess
        </button>
        {isAuthenticated && (
          <div className="session">
            <span className="empty mono">{nodeUrl ?? ""}</span>
            <button className="ghost" onClick={logout}>
              Log out
            </button>
          </div>
        )}
      </header>
      <PlayPage />
    </div>
  );
}

export function App() {
  return (
    <BrowserRouter basename="/">
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
        <Route path="/play" element={<AppShell />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
