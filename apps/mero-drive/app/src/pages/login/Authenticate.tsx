// Auth entry point — mirrors battleships' pattern exactly:
//
//   A. Not authenticated → landing page + `<ConnectButton />`
//   B. Authenticated      → redirect to /app
//
// `<ConnectButton />` is shipped by @calimero-network/mero-react. It
// owns the entire flow: opens the LoginModal, takes a node URL,
// hands off to the node's /auth/login, receives the OAuth callback
// (parsed by MeroProvider via parseAuthCallback on mount), stores
// tokens, and flips useMero().isAuthenticated — at which point the
// effect below navigates to /app.
//
// We keep our own Hero / Features / CTA / Footer sections for the
// visual landing experience; the Hero / CTA "Get Started" / "Connect"
// buttons open the mero-react login modal directly (the same flow the
// ConnectButton triggers) via a controlled <LoginModal>.

import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  useMero,
  ConnectButton,
  LoginModal,
  ConnectionType,
} from '@calimero-network/mero-react';
import { Hero } from '@/components/landing/Hero';
import { Features } from '@/components/landing/Features';
import { EditorPreview } from '@/components/landing/EditorPreview';
import { CTA } from '@/components/landing/CTA';
import { Footer } from '@/components/landing/Footer';

const Authenticate: React.FC = () => {
  const navigate = useNavigate();
  const { isAuthenticated, connectToNode } = useMero();
  // Controls the mero-react login modal opened by the landing CTAs.
  const [loginOpen, setLoginOpen] = useState(false);

  useEffect(() => {
    if (isAuthenticated) navigate('/app');
  }, [isAuthenticated, navigate]);

  // Hero / CTA "Get Started" / "Connect" buttons open the login modal
  // directly — the same node-picker + OAuth handoff the ConnectButton
  // runs — instead of merely scrolling to the button. connectToNode is
  // mero-react's public connect entry point; once it resolves, the
  // OAuth callback flips isAuthenticated and the effect above routes to
  // /app.
  const openLogin = () => setLoginOpen(true);

  return (
    <div className="min-h-screen bg-background">
      <Hero onConnect={openLogin} />

      {/* Dedicated mero-react connect surface — also reflects connection
          status. A second visible entry point alongside the CTAs. */}
      <div className="flex justify-center py-10">
        <ConnectButton />
      </div>

      <Features />
      <EditorPreview />
      <CTA onConnect={openLogin} />
      <Footer />

      <LoginModal
        isOpen={loginOpen}
        onClose={() => setLoginOpen(false)}
        onConnect={(url) => {
          connectToNode(url);
          setLoginOpen(false);
        }}
        connectionType={ConnectionType.RemoteAndLocal}
      />
    </div>
  );
};

export default Authenticate;
