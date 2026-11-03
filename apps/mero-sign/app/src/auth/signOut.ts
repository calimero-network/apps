import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { clearDefaultContext } from '../api/defaultContextService';
import { useCalimero } from '../lib/useCalimero';
import { setActiveWorkspace } from '../lib/activeWorkspace';

/**
 * What this app remembers about the account that is signed in, beyond the
 * session itself: the agreement it last opened (the library's id is kept in
 * memory, see `clearDefaultContext`). It belongs to the account, so it may not
 * outlive the session — the next person to sign in on this browser is not a
 * member of that agreement.
 */
export const ACCOUNT_KEYS = [
  'agreementContextID',
] as const;

/**
 * Log out: forget the workspace and agreement this browser had open and the
 * remembered library, then end the session (the stored passkey session for
 * this app and target).
 *
 * The selection goes FIRST, so nothing that re-renders as the session ends
 * can read it back in. The light/dark choice stays: it belongs to the browser,
 * not the account.
 */
export function signOut(logout: () => void): void {
  setActiveWorkspace(null);
  clearDefaultContext();
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
  const { logout } = useCalimero();
  const navigate = useNavigate();
  return useCallback(() => {
    signOut(logout);
    navigate('/', { replace: true });
  }, [logout, navigate]);
}
