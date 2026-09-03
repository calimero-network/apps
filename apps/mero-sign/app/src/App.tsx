import React, { useState, useEffect } from 'react';
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
import { hasPendingInvitation } from './utils/invitation';

function AppContent() {
  const { isAuthenticated } = useCalimero();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showInvitationHandler, setShowInvitationHandler] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    // Check for pending invitation when authenticated
    if (isAuthenticated && hasPendingInvitation()) {
      setShowInvitationHandler(true);
    }
  }, [isAuthenticated]);

  const handleInvitationSuccess = () => {
    setShowInvitationHandler(false);
    // Navigate to dashboard and reload agreements
    navigate('/');
    window.location.reload(); // Reload to refresh agreements list
  };

  const handleInvitationError = () => {
    setShowInvitationHandler(false);
  };

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
        <Route
          path="/"
          element={<LandingPage onConnect={() => setSidebarOpen(true)} />}
        />
        <Route
          path="*"
          element={
            <MobileLayout sidebarOpen={sidebarOpen} onSidebarToggle={setSidebarOpen}>
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
        {isAuthenticated ? (
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/agreement" element={<AgreementPage />} />
            <Route path="/signatures" element={<SignaturesPage />} />
            <Route path="*" element={<Dashboard />} />
          </Routes>
        ) : (
          <CalimeroConnectionRequired
            onOpenSidebar={() => setSidebarOpen(true)}
          />
        )}
      </MobileLayout>
      {showInvitationHandler && isAuthenticated && (
        <InvitationHandlerPopup
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
