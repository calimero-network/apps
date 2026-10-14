import { Suspense, lazy, type ReactNode } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { ConnectButton, useMero } from "@calimero-network/mero-react";
import { JoinCard } from "./JoinCard";
import { ScenePicker } from "./ScenePicker";
import { useJoinFromInvitation } from "./useJoinFromInvitation";
import LandingPage from "./pages/landing/LandingPage";

/**
 * The modeller is three.js and most of this bundle; the landing page a stranger
 * opens first should not wait for it.
 */
const Studio = lazy(() => import("./studio/Studio").then((m) => ({ default: m.Studio })));

/** Every path the shared landing page serves. See src/pages/landing. */
const LANDING_PATHS = ["/", "/docs", "/preview"];

/**
 * ⚠️ `useMero()` lives HERE, not in `LandingPage`: that component is generated
 * from a template shared by the whole fleet, and some apps render it with no
 * `MeroProvider` above them.
 */
function AppLandingPage() {
  const { isAuthenticated } = useMero();
  const navigate = useNavigate();
  return <LandingPage isAuthenticated={isAuthenticated} onOpenApp={() => navigate("/studio")} />;
}

/**
 * The SSO callback returns to wherever login started — for someone who pressed
 * Connect on the landing page, that is `/`. This is what carries them on into
 * the app instead of back to the page they started on. Router state, not a
 * query parameter, marks a deliberate visit from inside the app: state never
 * survives the cold navigation the callback arrives as.
 */
function RedirectIfAuthed({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useMero();
  const location = useLocation();
  const deliberate = (location.state as { fromApp?: boolean } | null)?.fromApp === true;
  if (isLoading) return null;
  if (isAuthenticated && !deliberate) return <Navigate to="/studio" replace />;
  return <>{children}</>;
}

/** Connect, pick a scene, model. Three states — exactly the three things that can be missing. */
function StudioPage() {
  const { isAuthenticated, isLoading, applicationId, contextId } = useMero();
  // Mounted unconditionally: an invitation captured before login is redeemed
  // the moment a session exists.
  const { state: joinState, redeemPasted, confirmJoin, declineJoin } = useJoinFromInvitation();
  const navigate = useNavigate();

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
      <div className="page">
        <TopBar onHome={() => navigate("/", { state: { fromApp: true } })} />
        <section className="connect">
          <div className="connect-card">
            <img className="connect-mark" src="/favicon.svg" alt="" />
            <h1>Connect a node</h1>
            <p className="lede">
              Mero Models runs on your own Calimero node. The login finds one on the usual local ports, or takes a URL.
            </p>
            <ConnectButton />
            <ul className="connect-points">
              <li>No server holds your models</li>
              <li>Real-time co-editing</li>
              <li>OBJ · STL · glTF in and out</li>
            </ul>
          </div>
        </section>
      </div>
    );
  }

  const join = (
    <JoinCard state={joinState} onSubmit={redeemPasted} onConfirm={confirmJoin} onDecline={declineJoin} />
  );

  if (!contextId) {
    return (
      <div className="page">
        <TopBar onHome={() => navigate("/", { state: { fromApp: true } })} />
        <main className="wrap">
          <ScenePicker applicationId={applicationId}>{join}</ScenePicker>
        </main>
      </div>
    );
  }

  return (
    <>
      {/* A link can arrive while a scene is open; the prompt must be reachable then too. */}
      {joinState.status !== "idle" && <div className="join-float">{join}</div>}
      <Suspense
        fallback={
          <div className="loading-state">
            <span className="spinner" aria-hidden="true" />
            <p className="empty">Loading the studio…</p>
          </div>
        }
      >
        <Studio contextId={contextId} />
      </Suspense>
    </>
  );
}

function TopBar({ onHome }: { onHome: () => void }) {
  const { isAuthenticated, nodeUrl, logout } = useMero();
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <button type="button" className="brand" onClick={onHome}>
          <img src="/favicon.svg" alt="" width={26} height={26} />
          <span>Mero Models</span>
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
  );
}

export function App() {
  return (
    <BrowserRouter basename="/">
      <Routes>
        {LANDING_PATHS.map((path) => (
          <Route
            key={path}
            path={path}
            // Only `/` bounces a signed-in visitor into the app; `/docs` and
            // `/preview` are reference pages a signed-in person may want.
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
        <Route path="/studio" element={<StudioPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
