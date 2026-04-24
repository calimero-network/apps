// Auth entry point. Three states in order:
//   A. Landing (Hero + Features + CTA) with a "Connect" button
//   B. Node-URL form (user types their node URL)
//   C. Authenticated — redirect to /app
//
// Uses mero-react's `connectToNode` — the library handles the OAuth
// callback, token storage, and re-render. No calimero-client.

import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMero } from '@calimero-network/mero-react';
import { Button } from '@/components/ui/button';
import { Hero } from '@/components/landing/Hero';
import { Features } from '@/components/landing/Features';
import { EditorPreview } from '@/components/landing/EditorPreview';
import { CTA } from '@/components/landing/CTA';
import { Footer } from '@/components/landing/Footer';

const Authenticate: React.FC = () => {
  const navigate = useNavigate();
  const { isAuthenticated, connectToNode, nodeUrl: currentNodeUrl } = useMero();
  const [showWebFlow, setShowWebFlow] = useState(false);
  const [nodeUrl, setNodeUrl] = useState('');
  const [connectError, setConnectError] = useState('');
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    if (isAuthenticated) {
      navigate('/app');
    }
  }, [isAuthenticated, navigate]);

  // If mero has a nodeUrl stored but isn't authenticated (user
  // disconnected / token expired), skip straight to the URL form
  // pre-filled so they don't retype it.
  useEffect(() => {
    if (!isAuthenticated && currentNodeUrl && !nodeUrl) {
      setNodeUrl(currentNodeUrl);
      setShowWebFlow(true);
    }
  }, [currentNodeUrl, isAuthenticated, nodeUrl]);

  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    const url = nodeUrl.trim().replace(/\/$/, '');
    if (!url) {
      setConnectError('Please enter your node URL.');
      return;
    }
    try {
      new URL(url);
    } catch {
      setConnectError("That doesn't look like a valid URL.");
      return;
    }
    setConnecting(true);
    setConnectError('');
    try {
      const res = await fetch(`${url}/auth/health`, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) throw new Error();
    } catch {
      setConnecting(false);
      setConnectError("Node not reachable. Make sure it's running and the URL is correct.");
      return;
    }
    // Hands off to mero-react: it navigates to the node's /auth/login,
    // handles the OAuth dance, stores tokens in its own localStorage
    // keys, and redirects back — isAuthenticated flips true and the
    // effect above routes us to /app.
    connectToNode(url);
  };

  // State B: node URL form
  if (!isAuthenticated && showWebFlow) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="w-full max-w-md p-8 rounded-2xl border border-border/50 bg-card shadow-lg">
          <h1 className="text-2xl font-semibold text-center mb-2">Connect to your node</h1>
          <p className="text-sm text-muted-foreground text-center mb-6">
            Enter the URL of your Calimero node to continue.
          </p>
          <form onSubmit={handleConnect} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="nodeUrl" className="text-sm font-medium text-muted-foreground">
                Node URL
              </label>
              <input
                id="nodeUrl"
                type="text"
                placeholder="https://node.example.com"
                value={nodeUrl}
                onChange={(e) => {
                  setNodeUrl(e.target.value);
                  setConnectError('');
                }}
                disabled={connecting}
                autoFocus
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              />
            </div>
            {connectError && (
              <p className="text-xs text-destructive text-center">{connectError}</p>
            )}
            <Button type="submit" disabled={connecting || !nodeUrl.trim()}>
              {connecting ? 'Checking node…' : 'Continue'}
            </Button>
            <button
              type="button"
              onClick={() => {
                setShowWebFlow(false);
                setConnectError('');
              }}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors text-center mt-1"
            >
              ← Back
            </button>
          </form>
        </div>
      </div>
    );
  }

  // State A: landing page
  return (
    <div className="min-h-screen bg-background">
      <Hero onConnect={() => setShowWebFlow(true)} />
      <Features />
      <EditorPreview />
      <CTA onConnect={() => setShowWebFlow(true)} />
      <Footer />
    </div>
  );
};

export default Authenticate;
