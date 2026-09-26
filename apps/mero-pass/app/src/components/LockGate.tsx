import { type ReactNode, useEffect, useState } from 'react';

import { useDeviceUnlocked } from '../hooks/useDeviceLock';
import { type Protection, deviceKeeper } from '../lib/deviceKey';
import shell from '../styles/shell.module.css';
import { describeError } from '../lib/errors';

/**
 * Nothing inside renders until this browser's device key is unlocked.
 *
 * Unprotected, unlocking is one click (the key is non-extractable at rest,
 * and the click is the gesture that says someone is at the keyboard). With a
 * passphrase it is the passphrase; with a passkey, the authenticator.
 * Auto-lock (`useAutoLock`) sends the user back here.
 *
 * "Forgot it" resets this browser: a fresh key that must be approved, or
 * restored from a recovery key, before it opens anything.
 */
export default function LockGate({ children }: { children: ReactNode }) {
  const unlocked = useDeviceUnlocked();
  const [protection, setProtection] = useState<Protection | null>(null);
  const [passphrase, setPassphrase] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [firstRun, setFirstRun] = useState(true);
  const [confirmReset, setConfirmReset] = useState(false);

  useEffect(() => {
    if (unlocked) return;
    deviceKeeper
      .protection()
      .then(async (p) => {
        setProtection(p);
        // First open in this tab and unprotected: no reason to make them click.
        if (p === 'none' && firstRun) {
          setFirstRun(false);
          await deviceKeeper.unlock();
        }
      })
      .catch(() => setProtection('none'));
  }, [unlocked, firstRun]);

  if (unlocked) return <>{children}</>;

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
    setProtection('none');
    await deviceKeeper.unlock();
  };

  return (
    <section className={shell.section} data-testid="lock-gate">
      <h2 className={shell.sectionTitle}>Locked</h2>
      <p className={shell.sectionHint}>
        Your vault keys were cleared from memory. Nothing is readable on this
        screen until you unlock.
      </p>
      {error && <p className={shell.error}>{error}</p>}
      <div className={shell.createRow}>
        {protection === 'passphrase' && (
          <input
            className={shell.input}
            type="password"
            autoComplete="current-password"
            placeholder="Device passphrase"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void unlock()}
            data-testid="unlock-passphrase"
            autoFocus
          />
        )}
        <button
          type="button"
          className={shell.btn}
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
        <div className={shell.createRow}>
          {!confirmReset ? (
            <button
              type="button"
              className={shell.btnGhost}
              onClick={() => setConfirmReset(true)}
            >
              Forgot your {protection}?
            </button>
          ) : (
            <>
              <p className={shell.sectionHint}>
                Resetting forgets this browser's key. Vaults that another of
                your devices, a teammate or your recovery key can open come back
                after approval or a restore; a vault only this browser held is
                lost.
              </p>
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
            </>
          )}
        </div>
      )}
    </section>
  );
}
