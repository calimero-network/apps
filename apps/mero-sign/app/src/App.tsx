import { useState, useEffect, useCallback } from 'react';
import { Routes, Route, BrowserRouter, useNavigate } from 'react-router-dom';
import { ThemeProvider } from './contexts/ThemeContext';
import Dashboard from './pages/dashboard';
import AgreementPage from './pages/agreement';
import SignaturesPage from './pages/signatures';
import { MobileLayout } from './components/MobileLayout';
import { CalimeroConnectionRequired } from './components/CalimeroConnectionRequired';
import LandingPage from './pages/landing/LandingPage';
import InvitationHandlerPopup from './components/InvitationHandlerPopup';
import { useCalimero } from '@calimero-network/calimero-client';
import {
  onInvitation,
  type CapturedInvitation,
} from './lib/invitationIntents';

function AppContent() {
  const { isAuthenticated } = useCalimero();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [invitation, setInvitation] = useState<CapturedInvitation | null>(null);
  const navigate = useNavigate();

  // ── Invitations are captured at APP level, not per page ────────────────────
  //
  // An invitation link can land anywhere: `/` for a web visitor, the launcher's
  // rewritten frontend URL on the desktop, or a route this app does not even
  // have. Subscribing here means the prompt appears wherever it lands.
  //
  // Subscribed OUTSIDE the `isAuthenticated` branch, and unconditionally. The
  // previous version only looked for an invitation once the session existed, and
  // only ever read `location.search` — so a signed-out visitor opening a link
  // went through the auth redirect and arrived with the invitation gone. The
  // platform store now holds the intent across that redirect (capture starts in
  // main.tsx, before React mounts) and replays it here.
  useEffect(() => onInvitation(setInvitation), []);

  const handleInvitationSuccess = useCallback(
    (agreement: { contextId: string; name: string }) => {
      invitation?.resolve();
      setInvitation(null);
      // The dashboard's list comes from the private context, which the redeem
      // routine has just written to. Navigating with a key forces it to reload
      // rather than showing the pre-join list.
      navigate('/', { replace: true, state: { joined: agreement.contextId } });
    },
    [invitation, navigate],
  );

  const handleInvitationError = useCallback(() => {
    // Acked on decline too, or the store replays the same invitation on every
    // reload and the prompt becomes impossible to dismiss.
    invitation?.resolve();
    setInvitation(null);
  }, [invitation]);

  // Unauthenticated, `/` is the explainer and every other path is the connect
  // gate. The app had no landing page at all: an unauthenticated visitor got
  // `CalimeroConnectionRequired` — a competent gate that says what to click and
  // never what MeroSign is. That component stays, and stays reachable, because
  // it is the right screen for losing a connection mid-session; it is just no
  // longer the front door.
  //
  // Rendered OUTSIDE MobileLayout: the landing page carries its own header and
  // footer, and nesting it in the app's sidebar chrome would show a signed-out
  // visitor a navigation rail into screens they cannot open.
  if (!isAuthenticated) {
    return (
      <Routes>
        {/* The landing page is three pages: `/`, `/docs` and `/preview`. They
            are real URLs so they can be shared and opened cold, which needs a
            route here — the catch-all below renders this app's connection
            screen, and would otherwise swallow a shared docs link. */}
        {['/', '/docs', '/preview'].map((landingPath) => (
          <Route
            key={landingPath}
            path={landingPath}
            element={<LandingPage onConnect={() => setSidebarOpen(true)} />}
          />
        ))}
        <Route
          path="*"
          element={
            <MobileLayout
              sidebarOpen={sidebarOpen}
              onSidebarToggle={setSidebarOpen}
            >
              <CalimeroConnectionRequired
                onOpenSidebar={() => setSidebarOpen(true)}
              />
            </MobileLayout>
          }
        />
      </Routes>
    );
  }

  return (
    <>
      <MobileLayout sidebarOpen={sidebarOpen} onSidebarToggle={setSidebarOpen}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/agreement" element={<AgreementPage />} />
          <Route path="/signatures" element={<SignaturesPage />} />
          <Route path="*" element={<Dashboard />} />
        </Routes>
      </MobileLayout>
      {invitation && (
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
