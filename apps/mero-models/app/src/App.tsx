import { Suspense, lazy, useCallback, useState, type ReactNode } from "react";
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
} from "@calimero-apps/cloud";
import { ScenePicker } from "./ScenePicker";
import { readInvitation, useJoinFromInvitation } from "./useJoinFromInvitation";
import LandingPage from "./pages/landing/LandingPage";

/**
 * The modeller is three.js and most of this bundle; the landing page a stranger
 * opens first should not wait for it.
 */
const Studio = lazy(() =>
  import("./studio/Studio").then((m) => ({ default: m.Studio })),
);

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
  return (
    <LandingPage
      isAuthenticated={isAuthenticated}
      onOpenApp={() => navigate("/studio")}
    />
  );
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
  const deliberate =
    (location.state as { fromApp?: boolean } | null)?.fromApp === true;
  if (isLoading) return null;
  if (isAuthenticated && !deliberate) return <Navigate to="/studio" replace />;
  return <>{children}</>;
}

/** A scene opened in this page, ahead of the one the provider read from storage. */
interface OpenedScene {
  contextId: string;
  namespaceId: string;
}

/** Connect, pick a scene, model. Three states — exactly the three things that can be missing. */
function StudioPage({ opened }: { opened: OpenedScene | null }) {
  const { isAuthenticated, isLoading, applicationId, contextId: stored } =
    useMero();
  const navigate = useNavigate();
  const contextId = opened?.contextId ?? stored;

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
              Mero Models runs on your own Calimero node. The login finds one on
              the usual local ports, or takes a URL.
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

  if (!contextId) {
    return (
      <div className="page">
        <TopBar onHome={() => navigate("/", { state: { fromApp: true } })} />
        <main className="wrap">
          <ScenePicker applicationId={applicationId} />
        </main>
      </div>
    );
  }

  return (
    <Suspense
      fallback={
        <div className="loading-state">
          <span className="spinner" aria-hidden="true" />
          <p className="empty">Loading the studio…</p>
        </div>
      }
    >
      {/* Keyed, so a scene opened in place starts from nothing of the last one's. */}
      <Studio
        key={contextId}
        contextId={contextId}
        namespaceId={opened?.contextId === contextId ? opened.namespaceId : null}
      />
    </Suspense>
  );
}

/**
 * The invitation prompt, above every route: mero-react's `InvitationDialog`.
 *
 * Mounted once, outside `<Routes>`, so navigation never unmounts it and a link
 * opened on any page — the landing page, the picker, an open scene — reaches
 * it. Shown once there is a session to join with; until then the captured
 * invitation waits. Joining opens the joined scene in the studio, and the
 * dialog holds "Syncing…" until the studio has read it (`useJoinSync` there).
 */
function InvitationPrompt({
  onOpen,
}: {
  onOpen: (contextId: string, namespaceId: string) => void;
}) {
  const navigate = useNavigate();
  const join = useJoinFromInvitation({
    landingPath: "/studio",
    onOpen: (contextId, namespaceId) => {
      onOpen(contextId, namespaceId);
      navigate("/studio");
    },
  });
  return (
    <>
      {/* Logged out with a link opened: "you're invited" and the login, not the landing page. */}
      <InvitationGate parse={readInvitation} noun="scene" appName="Mero Models" />
      <InvitationDialog
        redemption={join}
        noun="scene"
        appName="Mero Models"
        // The grant is the namespace, not just the scene the link names: one
        // invitation opens every scene in it, and the person accepting should
        // know that before they click.
        detail="Joining makes this node a member of the studio this scene belongs to, so every scene in it syncs here from the other members."
      />
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
  const [opened, setOpened] = useState<OpenedScene | null>(null);
  const open = useCallback(
    (contextId: string, namespaceId: string) =>
      setOpened({ contextId, namespaceId }),
    [],
  );
  return (
    <BrowserRouter basename="/">
      <InvitationPrompt onOpen={open} />
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
        <Route path="/studio" element={<StudioPage opened={opened} />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
