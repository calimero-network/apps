import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMero, useSubscription } from '@calimero-network/mero-react';

import { deviceKeeper, deviceLabel } from '../lib/deviceKey';
import { rememberedRecoveryKey } from '../lib/recoveryKey';
import { useVaultClient } from '../lib/vault';
import { vaultApiFor } from '../lib/vaultApi';
import {
  type DeviceRecord,
  type Secret,
  type SessionState,
  VaultSession,
} from '../lib/vaultSession';
import { vaultAudience } from '../lib/vaults';
import { useDeviceUnlocked } from './useDeviceLock';
import { describeError, isTransient } from '../lib/errors';

export interface VaultSessionView {
  session: VaultSession | null;
  state: SessionState | 'locked' | 'loading' | 'no-identity' | 'failed';
  secrets: Secret[];
  error: string | null;
  /** What the node is still doing while the vault cannot open yet. */
  notice: string | null;
  /** Other devices asking to be let in that this one may approve. */
  approvals: DeviceRecord[];
  /** This device waits for approval, not just for a key holder to come by. */
  awaitingApproval: boolean;
  /** Devices holding the current key; see `VaultSession.holders`. */
  holders: { browsers: number; recovery: number } | null;
  reload: () => Promise<void>;
  /** Try opening again after a failure that did not clear on its own. */
  retry: () => void;
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
 *
 * Once ready, it also gives this browser's recovery key (if one was set up
 * here) to a vault that lacks it, and lists the approval requests this
 * device may answer.
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
  const [notice, setNotice] = useState<string | null>(null);
  const [attempts, setAttempts] = useState(0);
  const [approvals, setApprovals] = useState<DeviceRecord[]>([]);
  const [awaitingApproval, setAwaitingApproval] = useState(false);
  const [holders, setHolders] = useState<VaultSessionView['holders']>(null);
  const busy = useRef(false);

  const reload = useCallback(async () => {
    if (!session || busy.current) return;
    busy.current = true;
    try {
      const s = await session.refreshKeys();
      const allowed =
        mero && team ? await vaultAudience(mero.admin, team) : null;
      if (s === 'ready') {
        const recovery = rememberedRecoveryKey();
        if (recovery) await session.adoptRecoveryKey(recovery).catch(() => {});
        if (allowed) await session.housekeep(allowed).catch(() => {});
        setApprovals(await session.pendingApprovals(allowed));
        setHolders(await session.holders());
        setAwaitingApproval(false);
      } else {
        setApprovals([]);
        setHolders(null);
        setAwaitingApproval(
          s === 'waiting' && (await session.awaitingApproval(allowed)),
        );
      }
      setSecrets(await session.list());
      setState(session.state);
      setError(null);
    } catch (e) {
      setError(describeError(e));
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
    let retry: ReturnType<typeof setTimeout> | undefined;
    setState('loading');
    setError(null);
    setNotice(null);
    const s = new VaultSession(vaultApiFor(client), device, fp, deviceLabel());
    // A vault just joined is often not usable yet: the node is still syncing
    // its state or waiting for the team key. Those clear on their own, so keep
    // trying and say what is happening, rather than stopping at the first
    // refusal and leaving "Opening the vault…" up forever.
    const attempt = (delay: number) => {
      s.open()
        .then(() => {
          if (cancelled) return;
          setNotice(null);
          setSession(s);
        })
        .catch((e) => {
          if (cancelled) return;
          if (isTransient(e)) {
            setNotice(describeError(e));
            retry = setTimeout(
              () => attempt(Math.min(delay * 2, 15_000)),
              delay,
            );
          } else {
            setState('failed');
            setError(describeError(e));
          }
        });
    };
    attempt(2_000);
    return () => {
      cancelled = true;
      clearTimeout(retry);
    };
  }, [unlocked, client, contextId, attempts]);

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

  return {
    session,
    state,
    secrets,
    error,
    notice,
    approvals,
    awaitingApproval,
    holders,
    reload,
    retry: () => setAttempts((n) => n + 1),
  };
}
