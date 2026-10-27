import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMero } from '@calimero-apps/cloud';
import { clearPersistedWorkspace } from '../hooks/workspacePersistence';

/**
 * Log out: forget which workspace and repository this browser had open (and
 * the "already asked for your name" markers that go with them), then
 * let mero-react drop the session (its token store, the `mero:*` keys and any
 * delegated account), exactly as Chat and Sheets do.
 *
 * The workspace selection goes too because the next person to sign in on this
 * browser may not be a member of it. The light/dark choice stays: it belongs
 * to the browser, not the account.
 */
export function signOut(logout: () => void): void {
  clearPersistedWorkspace();
  logout();
}

/** `signOut`, then back to the front door. App.tsx's RequireAuth would bounce
 *  there anyway once the session is gone; going explicitly keeps the URL clean. */
export function useSignOut(): () => void {
  const { logout } = useMero();
  const navigate = useNavigate();
  return useCallback(() => {
    signOut(logout);
    navigate('/', { replace: true });
  }, [logout, navigate]);
}
