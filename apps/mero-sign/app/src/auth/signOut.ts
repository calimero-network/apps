import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMero } from '@calimero-apps/cloud';
import { setActiveWorkspace } from '../lib/activeWorkspace';

/**
 * What this app remembers about the account that is signed in, beyond the
 * session itself: the agreement it last opened and its member key there, and
 * its private signature-library context. All of it belongs to the account, so
 * none of it may outlive the session — the next person to sign in on this
 * browser is not a member of that agreement and does not own that library.
 */
export const ACCOUNT_KEYS = [
  'agreementContextID',
  'agreementContextUserID',
  'defaultContext',
  'defaultContextId',
  'defaultContextUserID',
] as const;

/**
 * Log out: forget the workspace and agreement this browser had open, then let
 * mero-react drop the session (its token store, the `mero:*` keys and any
 * delegated account), as Mero CRM, Chat and Sheets do.
 *
 * The selection goes FIRST, so nothing that re-renders as the session ends
 * can read it back in. The light/dark choice stays: it belongs to the browser,
 * not the account.
 */
export function signOut(logout: () => void): void {
  setActiveWorkspace(null);
  for (const key of ACCOUNT_KEYS) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* storage unavailable: nothing was remembered either */
    }
  }
  logout();
}

/** `signOut`, then back to the front door. The app routes would show the
 *  connect screen anyway once the session is gone; going to `/` explicitly
 *  lands on the landing page, which is what logging out should look like. */
export function useSignOut(): () => void {
  const { logout } = useMero();
  const navigate = useNavigate();
  return useCallback(() => {
    signOut(logout);
    navigate('/', { replace: true });
  }, [logout, navigate]);
}
