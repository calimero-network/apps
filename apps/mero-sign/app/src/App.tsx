import { useState, useEffect, useCallback } from 'react';
import { Routes, Route, BrowserRouter, useNavigate } from 'react-router-dom';
import { ThemeProvider } from './contexts/ThemeContext';
import AgreementsPage from './pages/app/AgreementsPage';
import WorkspacesPage from './pages/app/WorkspacesPage';
import AgreementPage from './pages/app/AgreementPage';
import SignaturesPage from './pages/app/SignaturesPage';
import ConnectGate from './components/ConnectGate';
import NotFound from './components/NotFound';
import LandingPage from './pages/landing/LandingPage';
import ConnectPopup from './pages/landing/ConnectPopup';
import InvitationHandlerPopup from './components/InvitationHandlerPopup';
import { useCalimero } from './lib/useCalimero';
import { ROUTES, type Screen } from './routes';
import { onInvitation, type CapturedInvitation } from './lib/invitationIntents';

/**
 * The single screen renderer.
 *
 * `App.tsx` maps the route table in `src/routes.ts` onto this, so the table is
 * the one description of what the app can show. Nothing here navigates: an
 * unauthenticated visitor on an app route is shown `ConnectGate` in place of the
 * page, at the URL they asked for, rather than being sent somewhere else. See
 * the long note in `src/routes.ts` for why that matters.
 */
function Screenful({
  screen,
  authed,
  publicScreen,
  onConnect,
}: {
  screen: Screen;
  authed: boolean;
  publicScreen: boolean;
  onConnect: () => void;
}) {
  if (!authed && !publicScreen) {
    return (
      <ConnectGate
        what={
          screen === 'signatures'
            ? 'Your signature library'
            : screen === 'workspaces'
              ? 'Your workspaces'
              : 'This agreement'
        }
      />
    );
  }

  switch (screen) {
    case 'workspaces':
      return <WorkspacesPage />;
    case 'agreements':
      return <AgreementsPage />;
    case 'agreement':
      return <AgreementPage />;
    case 'signatures':
      return <SignaturesPage />;
    case 'notFound':
      return <NotFound />;
    case 'landing':
    default:
      // Signed in, `/` is the app rather than the pitch — a render decision, not
      // a redirect, so the URL never changes under anybody. `/landing` keeps
      // showing the landing page either way, which is what makes it a front
      // door you can link to rather than a fallback you fall into.
      return authed && window.location.pathname === '/' ? (
        // Signed in at `/`, the app's home is the workspace picker: an
        // agreement cannot exist outside a workspace since rc.41 bound every
        // context to a group, so the agreements list is not a place to start.
        <WorkspacesPage />
      ) : (
        // ⚠️ `onConnect` is load-bearing. The landing template leaves this hook
        // for apps whose sign-in is not the shared popup, and Mero Sign is one
        // — it is on `@calimero-network/calimero-client` rather than mero-react,
        // so `landing:generate` writes it no `loginPopup`. It used to open the
        // sidebar; the sidebar is gone, so it opens a modal instead. Without
        // this the CTA does nothing, which is what deleting the sidebar did
        // until the landing suite caught it.
        <LandingPage onConnect={onConnect} />
      );
  }
}

function AppContent() {
  const { isAuthenticated } = useCalimero();
  const [invitation, setInvitation] = useState<CapturedInvitation | null>(null);
  const [connectOpen, setConnectOpen] = useState(false);
  const navigate = useNavigate();

  // Invitations are captured at APP level, not per page: a link can land on any
  // route. Subscribed unconditionally, outside any auth branch — capture starts
  // in main.tsx before React mounts, so an invitation survives the login
  // redirect. See `lib/invitationIntents.ts`.
  useEffect(() => onInvitation(setInvitation), []);

  const handleInvitationSuccess = useCallback(
    (agreement: {
      contextId: string | null;
      namespaceId: string | null;
      name: string;
    }) => {
      invitation?.resolve();
      setInvitation(null);
      // ⚠️ An invitation grants membership of a WORKSPACE. It resolves to a
      // single agreement only when the workspace holds exactly one, or when
      // the link named one that is in it. With none or several — both ordinary
      // — the workspace is where the person belongs, and
      // `/agreements/undefined` is where they used to end up.
      if (agreement.contextId) {
        navigate(`/agreements/${agreement.contextId}`, { replace: true });
      } else if (agreement.namespaceId) {
        navigate(`/workspaces/${agreement.namespaceId}`, { replace: true });
      } else {
        navigate('/workspaces', { replace: true });
      }
    },
    [invitation, navigate],
  );

  const handleInvitationError = useCallback(() => {
    // Acked on decline too, or the store replays it on every reload and the
    // prompt becomes impossible to dismiss.
    invitation?.resolve();
    setInvitation(null);
  }, [invitation]);

  return (
    <>
      <Routes>
        {ROUTES.map((r) => (
          <Route
            key={r.path}
            path={r.path}
            element={
              <Screenful
                screen={r.screen}
                authed={!!isAuthenticated}
                publicScreen={r.publicScreen}
                onConnect={() => setConnectOpen(true)}
              />
            }
          />
        ))}
      </Routes>
      <ConnectPopup
        isOpen={connectOpen && !isAuthenticated}
        onClose={() => setConnectOpen(false)}
      />
      {invitation && isAuthenticated && (
        <InvitationHandlerPopup
          invitation={invitation.code}
          onSuccess={handleInvitationSuccess}
          onError={handleInvitationError}
        />
      )}
    </>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <BrowserRouter basename="/">
        <AppContent />
      </BrowserRouter>
    </ThemeProvider>
  );
}
