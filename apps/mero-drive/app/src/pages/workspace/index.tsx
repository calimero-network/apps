// Auth-guarded shell for the /app/* route. Mirrors battleships'
// per-page guard pattern rather than the previous `<AuthedRoute>`
// wrapper at the router level. Key difference: guards on
// `!isLoading && !isAuthenticated` so a transient false during
// MeroProvider init doesn't bounce the user back to /login.

import React, { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useMero } from '@calimero-network/mero-react';
import { WorkspaceLayout } from '@/components/workspace/WorkspaceLayout';

export default function WorkspacePage() {
  const { isAuthenticated, isLoading } = useMero();
  const navigate = useNavigate();
  const location = useLocation();

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
