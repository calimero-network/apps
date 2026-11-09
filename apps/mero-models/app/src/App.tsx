import { useMemo, useState, type ReactNode } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import type { InviteStore, KeyValueStorage } from "@calimero-apps/connect";
import { usePendingInvite } from "@calimero-apps/passkey";
import LandingPage from "./pages/landing/LandingPage";
import { invites as appInvites } from "./scenes";
import { defaultDeps, useSession, type SessionDeps } from "./session";
import { StudioPage, base } from "./StudioPage";

/** Every path the shared landing page serves. See src/pages/landing. */
const LANDING_PATHS = ["/", "/docs", "/preview"];

/**
 * The landing page, with this app's own passkey sign-in behind "Sign in"
 * (`ownConnect` in scripts/landing/apps.config.mjs): it opens the studio,
 * whose front door is the sign-in.
 */
function AppLandingPage({ signedIn }: { signedIn: boolean }) {
  const navigate = useNavigate();
  return (
    <LandingPage
      isAuthenticated={signedIn}
      onOpenApp={() => navigate("/studio")}
      onConnect={() => navigate("/studio")}
    />
  );
}

/**
 * A signed-in visitor of `/`, or one who opened an invitation link, goes on
 * into the studio. Router state, not a query parameter, marks a deliberate
 * visit from inside the app.
 */
function RedirectIfSignedIn({
  signedIn,
  invited,
  children,
}: {
  signedIn: boolean;
  invited: boolean;
  children: ReactNode;
}) {
  const location = useLocation();
  const deliberate = (location.state as { fromApp?: boolean } | null)?.fromApp === true;
  if ((signedIn || invited) && !deliberate) return <Navigate to="/studio" replace />;
  return <>{children}</>;
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
  // Signed up with the invite: the account is in its studio already, which
  // the studio page opens once the session is signed in.
  const [landing, setLanding] = useState<{ org: string | null } | null>(null);
  const api = useSession(sessionDeps, invites, (joined, pending) =>
    setLanding({ org: joined.org ?? pending?.org ?? null }),
  );
  const invited = usePendingInvite(invites) !== null;
  const signedIn = api.session.status === "signed-in";
  return (
    <BrowserRouter basename={base()}>
      <Routes>
        {LANDING_PATHS.map((path) => (
          <Route
            key={path}
            path={path}
            // Only `/` bounces a signed-in visitor into the app; `/docs` and
            // `/preview` are reference pages a signed-in person may want.
            element={
              path === "/" ? (
                <RedirectIfSignedIn signedIn={signedIn} invited={invited}>
                  <AppLandingPage signedIn={signedIn} />
                </RedirectIfSignedIn>
              ) : (
                <AppLandingPage signedIn={signedIn} />
              )
            }
          />
        ))}
        <Route path="/studio" element={<StudioPage
              api={api}
              deps={sessionDeps}
              storage={storage}
              invites={invites}
              landing={landing}
              setLanding={setLanding}
            />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
