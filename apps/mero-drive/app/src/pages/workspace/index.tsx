// Auth-guarded shell for the /app/* route. Mirrors battleships'
// per-page guard pattern rather than the previous `<AuthedRoute>`
// wrapper at the router level. Key difference: guards on
// `!isLoading && !isAuthenticated` so a transient false during
// MeroProvider init doesn't bounce the user back to /login.

import React, { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useMero } from '@calimero-network/mero-react';
import { WorkspaceLayout } from '@/components/workspace/WorkspaceLayout';
import { ACTIVE_NS_KEY } from '@/hooks/useDriveWorkspace';

export default function WorkspacePage() {
  const { isAuthenticated, isLoading } = useMero();
  const navigate = useNavigate();
  const location = useLocation();

  // Clear app-specific localStorage on logout so the next user on
  // the same browser doesn't inherit the previous user's namespace
  // selection. Mirrors battleships' lobby-state reset on disconnect.
  const wasAuthenticatedRef = useRef(isAuthenticated);
  useEffect(() => {
    if (wasAuthenticatedRef.current && !isAuthenticated && !isLoading) {
      localStorage.removeItem(ACTIVE_NS_KEY);
    }
    wasAuthenticatedRef.current = isAuthenticated;
  }, [isAuthenticated, isLoading]);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      navigate('/login', {
        replace: true,
        state: { returnTo: location.pathname + location.search },
      });
    }
  }, [isLoading, isAuthenticated, navigate, location]);

  if (isLoading || !isAuthenticated) return null;
  return <WorkspaceLayout />;
}
