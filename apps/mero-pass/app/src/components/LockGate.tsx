import { type ReactNode, useEffect, useState } from 'react';
import { Lock } from '@calimero-network/mero-icons';

import { useDeviceUnlocked } from '../hooks/useDeviceLock';
import { type Protection, deviceKeeper } from '../lib/deviceKey';
import { rememberedRecoveryKey } from '../lib/recoveryKey';
import shell from '../styles/shell.module.css';
import gate from '../styles/gate.module.css';
import { describeError } from '../lib/errors';
import { ProtectStep, RecoveryStep } from './DeviceSetup';

/**
 * Nothing inside renders until this browser's device key is unlocked, and,
 * once per browser, until it is protected and has a recovery key.
 *
 *   1. No key yet: the browser makes its first one sealed under a passkey or
 *      a passphrase (`ProtectStep`). There is no unprotected default.
 *   2. Locked: the passphrase, or the authenticator. An unprotected key from
 *      before protection was required opens without asking, and goes to 3.
 *   3. Unprotected: it must be sealed before anything else shows.
 *   4. No recovery key remembered here: make one, or enter one already made
 *      (`RecoveryStep`).
 *
 * Auto-lock (`useAutoLock`) sends the user back to 2. "Forgot it" resets this
 * browser to 1: a fresh key that must be approved, or restored from a
 * recovery key, before it opens anything.
 */
export default function LockGate({ children }: { children: ReactNode }) {
  const unlocked = useDeviceUnlocked();
  const [protection, setProtection] = useState<Protection | 'missing' | null>(
    null,
  );
  const [needsRecovery, setNeedsRecovery] = useState(
    () => rememberedRecoveryKey() === null,
  );
  const [passphrase, setPassphrase] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [firstRun, setFirstRun] = useState(true);
  const [confirmReset, setConfirmReset] = useState(false);

  useEffect(() => {
    let cancelled = false;
    deviceKeeper
      .protection()
      .then(async (p) => {
        if (cancelled) return;
        setProtection(p);
        // An unprotected key from before: open it without a click, so the
        // next screen can be the one that protects it.
        if (p === 'none' && firstRun && !deviceKeeper.isUnlocked) {
          setFirstRun(false);
          await deviceKeeper.unlock();
        }
      })
      .catch(() => {
        if (!cancelled) setProtection('none');
      });
    return () => {
      cancelled = true;
    };
  }, [unlocked, firstRun]);

  const refresh = () => {
    void deviceKeeper.protection().then(setProtection);
  };

  if (protection === 'missing') return <ProtectStep fresh onDone={refresh} />;
  if (unlocked && protection === 'none')
    return <ProtectStep fresh={false} onDone={refresh} />;
  if (unlocked && protection !== null && needsRecovery)
    return <RecoveryStep onDone={() => setNeedsRecovery(false)} />;
  if (unlocked && protection !== null) return <>{children}</>;

  const unlock = async () => {
    setBusy(true);
    setError(null);
    try {
      await deviceKeeper.unlock(passphrase || undefined);
      setPassphrase('');
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    setError(null);
    await deviceKeeper.reset();
    setConfirmReset(false);
    setProtection('missing');
  };

  return (
    <section className={gate.gate} data-testid="lock-gate">
      <div className={gate.card}>
        <span className={gate.icon} aria-hidden="true">
          <Lock size={28} />
        </span>
        <h2 className={gate.title}>Locked</h2>
        <p className={gate.hint}>
          Your vault keys were cleared from memory. Nothing is readable on this
          screen until you unlock.
        </p>
        {error && <p className={shell.error}>{error}</p>}
        <div className={gate.form}>
          {protection === 'passphrase' && (
            <input
              className={shell.input}
              type="password"
              autoComplete="current-password"
              placeholder="Device passphrase"
              aria-label="Device passphrase"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void unlock()}
              data-testid="unlock-passphrase"
              autoFocus
            />
          )}
          <button
            type="button"
            className={`${shell.btn} ${gate.unlock}`}
            onClick={() => void unlock()}
            disabled={
              busy ||
              protection === null ||
              (protection === 'passphrase' && !passphrase)
            }
            data-testid="unlock"
          >
            {busy
              ? 'Unlocking…'
              : protection === 'passkey'
                ? 'Unlock with passkey'
                : 'Unlock'}
          </button>
        </div>
        {protection !== null && protection !== 'none' && (
          <div className={gate.forgot}>
            {!confirmReset ? (
              <button
                type="button"
                className={gate.link}
                onClick={() => setConfirmReset(true)}
              >
                Forgot your {protection}?
              </button>
            ) : (
              <>
                <p className={gate.hint}>
                  Resetting forgets this browser's key. Vaults that another of
                  your devices, a teammate or your recovery key can open come
                  back after approval or a restore; a vault only this browser
                  held is lost.
                </p>
                <div className={gate.form}>
                  <button
                    type="button"
                    className={shell.btnDanger}
                    onClick={() => void reset()}
                    data-testid="reset-device"
                  >
                    Reset this browser
                  </button>
                  <button
                    type="button"
                    className={shell.btnGhost}
                    onClick={() => setConfirmReset(false)}
                  >
                    Cancel
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
