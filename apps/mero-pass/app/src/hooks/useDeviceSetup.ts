import { useCallback, useMemo } from 'react';
import { useMero } from '@calimero-network/mero-react';

import { useApplicationId } from './useApplicationId';
import { deviceKeeper, deviceLabel } from '../lib/deviceKey';
import { restoreFromRecoveryKey, setUpRecoveryKey } from '../lib/recoveryKey';
import { type StatusFn, type VaultMero, migrateDevice } from '../lib/vaults';

/** The node and this browser's unlocked key, or an error to show. */
function connected(vaultMero: VaultMero | null, appId: string) {
  const device = deviceKeeper.device;
  const fingerprint = deviceKeeper.fingerprint;
  if (!vaultMero || !appId || !device || !fingerprint)
    throw new Error('Still connecting to your node. Try again.');
  return { conn: vaultMero, browser: { device, fingerprint } };
}

/**
 * What protecting this browser and making its recovery key need from the
 * node, shared by the lock screen's first-run setup and the Security page.
 *
 * `ready` is false until the node session and this app's id have resolved:
 * re-sealing an existing key moves every vault key onto the new one, and that
 * walks every vault on the node.
 */
export function useDeviceSetup() {
  // `admin` is the session-aware client; `mero.rpc` executes on each vault's
  // contract. On an account they are two objects (see `lib/vaults` `VaultMero`).
  const { mero, admin } = useMero();
  const { appId } = useApplicationId();
  const vaultMero = useMemo(
    () => (mero && admin ? { admin, rpc: mero.rpc } : null),
    [mero, admin],
  );
  const ready = !!vaultMero && !!appId;

  /**
   * Seal this browser's key under a passphrase or a passkey. A browser with
   * no key gets its first one; an existing key is replaced, and every vault
   * key it holds moves to the new one first. Returns how many moved.
   */
  const protect = useCallback(
    async (
      how: 'passphrase' | 'passkey',
      passphrase: string,
      onStatus?: StatusFn,
    ): Promise<number> => {
      const old = deviceKeeper.device;
      const oldFp = deviceKeeper.fingerprint;
      if (!old && (await deviceKeeper.protection()) !== 'missing')
        throw new Error('Unlock this browser first.');
      let moved = 0;
      const handOver = async (
        next: NonNullable<typeof old>,
        nextFp: string,
      ) => {
        // A browser's first key: there is nothing to move.
        if (!old || !oldFp) return;
        if (!vaultMero || !appId)
          throw new Error('Still connecting to your node. Try again.');
        moved = await migrateDevice(
          vaultMero,
          appId,
          { device: old, fingerprint: oldFp },
          { device: next, fingerprint: nextFp },
          deviceLabel(),
          onStatus,
        );
      };
      if (how === 'passphrase')
        await deviceKeeper.setPassphrase(passphrase, handOver);
      else await deviceKeeper.setPasskey(handOver);
      return moved;
    },
    [vaultMero, appId],
  );

  /** A new recovery key for every vault this browser holds; the code, once. */
  const createRecovery = useCallback(
    async (onStatus?: StatusFn) => {
      const { conn, browser } = connected(vaultMero, appId);
      return setUpRecoveryKey(conn, appId, browser, deviceLabel(), onStatus);
    },
    [vaultMero, appId],
  );

  /** Use an existing recovery code: every vault it opens comes to this browser. */
  const restoreRecovery = useCallback(
    async (code: string, onStatus?: StatusFn) => {
      const { conn, browser } = connected(vaultMero, appId);
      return restoreFromRecoveryKey(
        conn,
        appId,
        code,
        browser,
        deviceLabel(),
        onStatus,
      );
    },
    [vaultMero, appId],
  );

  return { ready, protect, createRecovery, restoreRecovery };
}
