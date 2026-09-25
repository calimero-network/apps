import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMero, useSubscription } from '@calimero-network/mero-react';

import { deviceKeeper, deviceLabel } from '../lib/deviceKey';
import { useVaultClient } from '../lib/vault';
import { vaultApiFor } from '../lib/vaultApi';
import {
  type Secret,
  type SessionState,
  VaultSession,
} from '../lib/vaultSession';
import { vaultAudience } from '../lib/vaults';
import { useDeviceUnlocked } from './useDeviceLock';

export interface VaultSessionView {
  session: VaultSession | null;
  state: SessionState | 'locked' | 'loading' | 'no-identity';
  secrets: Secret[];
  error: string | null;
  reload: () => Promise<void>;
}

/**
 * One vault, unlocked: the session, its decrypted secrets, and live updates.
 *
 * Opens the session once the device key is unlocked and this node holds an
 * identity in the vault's context. Re-reads when the contract emits an event
 * (a member on another node changed something), and polls while this device
 * is waiting to be given the key.
 *
 * `team` is the vault's namespace and subgroup when known; with it, key
 * hand-outs are restricted to the people the node says are still entitled
 * (the team, or the vault's own members when it is invite-only).
 */
export function useVaultSession(
  contextId: string | null,
  team: { namespaceId: string; vaultId: string } | null,
): VaultSessionView {
  const { mero } = useMero();
  const client = useVaultClient(contextId);
  const unlocked = useDeviceUnlocked();
  const [session, setSession] = useState<VaultSession | null>(null);
  const [state, setState] = useState<VaultSessionView['state']>('loading');
  const [secrets, setSecrets] = useState<Secret[]>([]);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);

  const reload = useCallback(async () => {
    if (!session || busy.current) return;
    busy.current = true;
    try {
      const s = await session.refreshKeys();
      if (s === 'ready' && mero && team) {
        const allowed = await vaultAudience(mero.admin, team);
        if (allowed) await session.housekeep(allowed).catch(() => {});
      }
      setSecrets(await session.list());
      setState(session.state);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      busy.current = false;
    }
  }, [session, mero, team]);

  // Open (or drop) the session as the lock and the client change.
  useEffect(() => {
    if (!unlocked) {
      setSession(null);
      setSecrets([]);
      setState('locked');
      return;
    }
    if (!contextId) return;
    if (!client) {
      setState('no-identity');
      return;
    }
    const device = deviceKeeper.device;
    const fp = deviceKeeper.fingerprint;
    if (!device || !fp) return;
    let cancelled = false;
    setState('loading');
    const s = new VaultSession(vaultApiFor(client), device, fp, deviceLabel());
    s.open()
      .then(() => {
        if (!cancelled) setSession(s);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [unlocked, client, contextId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Live: any contract event in this vault means something changed.
  // Memoised: a fresh array each render would resubscribe every render.
  const subscribed = useMemo(() => (contextId ? [contextId] : []), [contextId]);
  useSubscription(subscribed, () => {
    void reload();
  });

  // While waiting for the key, look again every few seconds.
  useEffect(() => {
    if (state !== 'waiting' && state !== 'uninitialised') return;
    const t = setInterval(() => void reload(), 5_000);
    return () => clearInterval(t);
  }, [state, reload]);

  return { session, state, secrets, error, reload };
}
