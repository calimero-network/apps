import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMero } from '@calimero-apps/cloud';

import { clearApplicationIdCache } from '../hooks/useApplicationId';
import { clearCopiedSecretNow } from '../lib/clipboard';
import { deviceKeeper } from '../lib/deviceKey';
import { forgetLastVisits } from '../lib/lastVisit';

/**
 * Log out of Mero Pass.
 *
 * In this order, because each step is about what the NEXT person at this
 * browser can reach:
 *
 *   1. lock the device key. Every open vault session listens to the lock and
 *      drops its keyring and its decrypted items with it, so nothing that
 *      opens a vault is left in memory;
 *   2. clear a copied secret from the clipboard now, rather than when its
 *      30-second timer would have;
 *   3. forget which installed application this browser resolved for the node
 *      (the app selection; the next sign-in may be to another node), and the
 *      team and vault it had open last (`lib/lastVisit`), so the next sign-in
 *      is not resumed into somebody else's vault;
 *   4. let mero-react drop the session: its token store, the `mero:*` keys and
 *      any delegated account.
 *
 * What stays: the light/dark choice and the auto-lock delay belong to the
 * browser, not the account, and the device key itself stays sealed at rest in
 * IndexedDB (locking is what makes it unusable; deleting it would lose every
 * vault only this browser holds).
 */
export function signOut(logout: () => void): void {
  deviceKeeper.lock();
  void clearCopiedSecretNow();
  clearApplicationIdCache();
  forgetLastVisits();
  logout();
}

/** `signOut`, then back to the front door with nothing in history to return to. */
export function useSignOut(): () => void {
  const { logout } = useMero();
  const navigate = useNavigate();
  return useCallback(() => {
    signOut(logout);
    navigate('/', { replace: true });
  }, [logout, navigate]);
}
