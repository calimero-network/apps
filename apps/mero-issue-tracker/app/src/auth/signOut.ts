import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

import { useSessionApi } from '../sessionContext';
import { clearPersistedWorkspace } from '../hooks/workspacePersistence';

/**
 * Forget the workspace selection, then end the session. In that order, so
 * nothing re-enters the old workspace on the way out.
 */
export function signOut(logout: () => void): void {
  clearPersistedWorkspace();
  logout();
}

/** Sign out (the node revokes the session) and land on the front door. */
export function useSignOut(): () => void {
  const { api } = useSessionApi();
  const navigate = useNavigate();
  return useCallback(() => {
    signOut(() => void api.signOut());
    navigate('/', { replace: true });
  }, [api, navigate]);
}
