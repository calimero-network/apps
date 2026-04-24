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
// visual landing experience; the CTA's onConnect is wired to the
// mero-react connect flow via scrolling the ConnectButton into view.

import React, { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMero, ConnectButton } from '@calimero-network/mero-react';
import { Hero } from '@/components/landing/Hero';
import { Features } from '@/components/landing/Features';
import { EditorPreview } from '@/components/landing/EditorPreview';
import { CTA } from '@/components/landing/CTA';
import { Footer } from '@/components/landing/Footer';

const Authenticate: React.FC = () => {
  const navigate = useNavigate();
  const { isAuthenticated } = useMero();
  const connectRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isAuthenticated) navigate('/app');
  }, [isAuthenticated, navigate]);

  // CTA / Hero buttons call this to bring the ConnectButton into view
  // and trigger its login flow. Clicking ConnectButton itself also
  // works without this — the scroll is a UX affordance for the
  // landing-page "Connect" / "Get Started" buttons rendered far from
  // the actual auth control.
  const scrollToConnect = () => {
    connectRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  return (
    <div className="min-h-screen bg-background">
      <Hero onConnect={scrollToConnect} />

      {/* Dedicated mero-react connect surface. Sits between Hero and
          Features so the CTA scrolls the user into an obvious
          call-to-action zone. */}
      <div ref={connectRef} className="flex justify-center py-10">
        <ConnectButton />
      </div>

      <Features />
      <EditorPreview />
      <CTA onConnect={scrollToConnect} />
      <Footer />
    </div>
  );
};

export default Authenticate;
