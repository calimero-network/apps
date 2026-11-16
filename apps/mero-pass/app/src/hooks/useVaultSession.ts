import { useCallback, useEffect, useRef, useState } from 'react';

import { useCalimero } from '../calimero';

import { deviceKeeper, deviceLabel } from '../lib/deviceKey';
import { rememberedRecoveryKey } from '../lib/recoveryKey';
import { useVaultClient } from '../lib/vault';
import { vaultApiFor } from '../lib/vaultApi';
import {
  type DeviceRecord,
  type Secret,
  type SessionState,
  VaultSession,
} from '@calimero-network/mero-pass';
import { vaultAudience } from '../lib/vaults';
import { useDeviceUnlocked } from './useDeviceLock';
import { visibleInterval } from '../lib/visibleInterval';
import { describeError, isTransient } from '../lib/errors';

/** How often a device waiting for the vault key looks again. */
export const WAITING_POLL_MS = 5_000;

/** How long asks for a read wait for others to join them. */
export const RELOAD_COALESCE_MS = 250;

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
  holders: { browsers: number; recovery: number; agents: number } | null;
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
  // The audience read lists the org's (or the vault team's) members; a null
  // audience means no key is ever handed out.
  const { client: calimero, source } = useCalimero();
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
  // Asked for while a read was running: one more read once it is done, so a
  // change that arrives mid-read is not lost and a burst becomes one read.
  const again = useRef(false);

  const read = useCallback(async () => {
    if (!session) return;
    if (busy.current) {
      again.current = true;
      return;
    }
    busy.current = true;
    again.current = false;
    try {
      const s = await session.refreshKeys();
      const allowed =
        calimero && team
          ? await vaultAudience({ client: calimero, source }, team)
          : null;
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
      if (again.current) void readRef.current();
    }
  }, [session, calimero, source, team]);
  const readRef = useRef(read);
  readRef.current = read;

  // A write here and the event it emits come within moments of each other,
  // and a key rotation emits one event per secret it re-seals: each asks for a
  // read, and the asks that land together are one read.
  const pending = useRef<{
    timer: ReturnType<typeof setTimeout>;
    done: Promise<void>;
  } | null>(null);
  const reload = useCallback((): Promise<void> => {
    if (pending.current) return pending.current.done;
    let settle: () => void = () => {};
    const done = new Promise<void>((resolve) => (settle = resolve));
    const timer = setTimeout(() => {
      pending.current = null;
      void readRef.current().finally(settle);
    }, RELOAD_COALESCE_MS);
    pending.current = { timer, done };
    return done;
  }, []);
  useEffect(
    () => () => {
      if (pending.current) clearTimeout(pending.current.timer);
      pending.current = null;
    },
    [],
  );

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
    void read();
  }, [read]);

  // Live: any contract event in this vault means something changed. Events
  // carry ids only, so each one is a cue to re-read through the session; the
  // cues that arrive together are one read (`reload`).
  const reloadRef = useRef(reload);
  reloadRef.current = reload;
  useEffect(() => {
    if (!calimero || !contextId || !session) return;
    const abort = new AbortController();
    void (async () => {
      try {
        // Where the vault's log is now: the stream starts after it rather than
        // replaying every event since the vault began.
        const { index } = await calimero.apps.view(
          { app: contextId, method: 'vaultInfo', args: {} },
          { signal: abort.signal },
        );
        for await (const _event of calimero.events(
          contextId,
          typeof index === 'number' ? index + 1 : undefined,
          abort.signal,
        )) {
          void reloadRef.current();
        }
      } catch {
        // The stream ended (aborted, or the node went away): the polls and the
        // next reload still bring changes in.
      }
    })();
    return () => abort.abort();
  }, [calimero, contextId, session]);

  // While waiting for the key, look again every few seconds: only while the
  // tab is visible, and at once when it is shown again.
  useEffect(() => {
    if (state !== 'waiting' && state !== 'uninitialised') return;
    return visibleInterval(() => void read(), WAITING_POLL_MS);
  }, [state, read]);

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
