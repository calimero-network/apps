import { useState } from 'react';
import { Routes, Route, BrowserRouter } from 'react-router-dom';
import { nodeBasename as servedBasename } from '@calimero-apps/node-served';
import { ThemeProvider } from './contexts/ThemeContext';
import AgreementsPage from './pages/app/AgreementsPage';
import WorkspacesPage from './pages/app/WorkspacesPage';
import AgreementPage from './pages/app/AgreementPage';
import SignaturesPage from './pages/app/SignaturesPage';
import ConnectGate from './components/ConnectGate';
import NotFound from './components/NotFound';
import LandingPage from './pages/landing/LandingPage';
import InvitationHandlerPopup from './components/InvitationHandlerPopup';
import InvitationPage from './components/InvitationPage';
import { pendingInvite } from './lib/invites';
import { useCalimero } from './lib/useCalimero';
import { SignInModal } from './lib/loginGate';
import { ROUTES, type Screen } from './routes';
import type { SessionDeps } from './session';
import { SessionProvider, useSessionApi } from './sessionContext';

/** Relative, so the same build runs at / and under the node's served path. */
const BASE = servedBasename(new URL(window.location.href), '/');
const nodeBasename = (): string => BASE;

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
      // a redirect (the picker it renders settles the URL once it has listed;
      // see below). `/landing` keeps showing the landing page either way,
      // which is what makes it a front door you can link to rather than a
      // fallback you fall into.
      return authed && window.location.pathname.replace(/\/$/, '') === nodeBasename().replace(/\/$/, '') ? (
        // Signed in at `/`, the app's home is the workspace picker: an
        // agreement cannot exist outside a workspace since rc.41 bound every
        // context to a group, so the agreements list is not a place to start.
        // `resume`: once it has listed, the picker replaces `/` with the
        // workspace open last (when the node still lists it) or with
        // `/workspaces`. That is the page acting on what it listed, not this
        // renderer navigating; `/workspaces` itself shows the list as-is.
        <WorkspacesPage resume />
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
  const { isAuthenticated, login } = useCalimero();
  const { api } = useSessionApi();
  const [notNow, setNotNow] = useState(false);

  // Restoring a stored session: render nothing rather than flash the
  // connect screen at someone already signed in.
  if (api.session.status === 'connecting') return null;

  // A signed-out visitor who opened an invitation link sees the invitation as
  // a page, in place of whatever the link's route shows: no landing hero
  // behind it and no extra click to find the sign-in. Nothing navigates, so
  // the address (under the `/<version>/` basename) is still the deep link once
  // they are signed in. "Not now" falls through to the routes and keeps the
  // token.
  if (api.session.status === 'signed-out' && !notNow && pendingInvite()) {
    return <InvitationPage onNotNow={() => setNotNow(true)} />;
  }

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
                authed={isAuthenticated}
                publicScreen={r.publicScreen}
                onConnect={login}
              />
            }
          />
        ))}
      </Routes>
      <SignInModal />
      {/* Invitations are captured at APP level, not per page: a link can land
          on any route. Capture runs in main.tsx before React mounts, so the
          token survives the passkey sign-up, and the prompt waits for a
          session before it asks. */}
      <InvitationHandlerPopup />
    </>
  );
}

export default function App({ deps }: { deps?: SessionDeps } = {}) {
  return (
    <SessionProvider deps={deps}>
      <ThemeProvider>
        <BrowserRouter basename={nodeBasename()}>
          <AppContent />
        </BrowserRouter>
      </ThemeProvider>
    </SessionProvider>
  );
}
