import { useCallback, useMemo } from 'react';

import { useCalimero } from '../calimero';
import { deviceKeeper, deviceLabel } from '../lib/deviceKey';
import { restoreFromRecoveryKey, setUpRecoveryKey } from '../lib/recoveryKey';
import { type Conn, type StatusFn, migrateDevice } from '../lib/vaults';

/** The node and this browser's unlocked key, or an error to show. */
type VaultConn = Pick<Conn, 'client' | 'source' | 'after'>;

function connected(vaultMero: VaultConn | null) {
  const device = deviceKeeper.device;
  const fingerprint = deviceKeeper.fingerprint;
  if (!vaultMero || !device || !fingerprint)
    throw new Error('Still connecting to Calimero. Try again.');
  return { conn: vaultMero, browser: { device, fingerprint } };
}

/**
 * What protecting this browser and making its recovery key need from the
 * node, shared by the lock screen's first-run setup and the Security page.
 *
 * `ready` is false until the session is signed in: re-sealing an existing
 * key moves every vault key onto the new one, and that walks every vault.
 */
export function useDeviceSetup() {
  const { client, source, after, isAuthenticated } = useCalimero();
  const vaultMero = useMemo<VaultConn | null>(
    () => (client && isAuthenticated ? { client, source, after } : null),
    [client, source, after, isAuthenticated],
  );
  const ready = !!vaultMero;

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
        if (!vaultMero)
          throw new Error('Still connecting to Calimero. Try again.');
        moved = await migrateDevice(
          vaultMero,
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
    [vaultMero],
  );

  /** A new recovery key for every vault this browser holds; the code, once. */
  const createRecovery = useCallback(
    async (onStatus?: StatusFn) => {
      const { conn, browser } = connected(vaultMero);
      return setUpRecoveryKey(conn, browser, deviceLabel(), onStatus);
    },
    [vaultMero],
  );

  /** Use an existing recovery code: every vault it opens comes to this browser. */
  const restoreRecovery = useCallback(
    async (code: string, onStatus?: StatusFn) => {
      const { conn, browser } = connected(vaultMero);
      return restoreFromRecoveryKey(
        conn,
        code,
        browser,
        deviceLabel(),
        onStatus,
      );
    },
    [vaultMero],
  );

  return { ready, protect, createRecovery, restoreRecovery };
}
