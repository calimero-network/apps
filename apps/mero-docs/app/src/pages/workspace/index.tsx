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
import { parseRemembered } from '@/lib/namespaceSelection';
import { clearReturnTo, parseAppPath, saveReturnTo } from '@/lib/routes';

/** The last workspace used on this browser, and the node it was on. */
function readRemembered() {
  try {
    return parseRemembered(JSON.parse(localStorage.getItem(ACTIVE_NS_KEY) ?? 'null'));
  } catch {
    return null;
  }
}

export default function WorkspacePage() {
  const { isAuthenticated, isLoading } = useMero();
  const navigate = useNavigate();
  const location = useLocation();

  // On logout, clear the namespace selection so the next user on the same
  // browser doesn't inherit it; a signed-out visitor's link is kept instead,
  // so sign-in (which returns to `/`) can carry on to it. A page in the
  // remembered workspace is the user's own, not a link, and is tied to the
  // node it was on, so signing in to another node does not reopen it there.
  const wasAuthenticatedRef = useRef(isAuthenticated);
  useEffect(() => {
    if (isLoading) return;
    if (isAuthenticated) clearReturnTo();
    else {
      if (wasAuthenticatedRef.current) localStorage.removeItem(ACTIVE_NS_KEY);
      else {
        const own = readRemembered();
        const ws = parseAppPath(location.pathname, location.hash)?.ws;
        saveReturnTo(
          location.pathname + location.search + location.hash,
          own && own.ns === ws ? own.node : undefined,
        );
      }
      navigate('/', { replace: true });
    }
    wasAuthenticatedRef.current = isAuthenticated;
  }, [isLoading, isAuthenticated, navigate, location]);

  if (isLoading || !isAuthenticated) return null;
  return <WorkspaceLayout />;
}
