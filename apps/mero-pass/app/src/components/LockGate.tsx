import { type ReactNode, useEffect, useState } from 'react';

import { useDeviceUnlocked } from '../hooks/useDeviceLock';
import { WrongPinError, deviceKeeper } from '../lib/deviceKey';
import shell from '../styles/shell.module.css';

/**
 * Nothing inside renders until this browser's device key is unlocked.
 *
 * Without a PIN, unlocking is one click (the key is non-extractable at rest,
 * and the click is the gesture that says someone is at the keyboard). With a
 * PIN, it is the PIN. Auto-lock (`useAutoLock`) sends the user back here.
 */
export default function LockGate({ children }: { children: ReactNode }) {
  const unlocked = useDeviceUnlocked();
  const [hasPin, setHasPin] = useState<boolean | null>(null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [firstRun, setFirstRun] = useState(true);

  useEffect(() => {
    if (unlocked) return;
    deviceKeeper
      .hasPin()
      .then(async (p) => {
        setHasPin(p);
        // First open in this tab and no PIN: no reason to make them click.
        if (!p && firstRun) {
          setFirstRun(false);
          await deviceKeeper.unlock();
        }
      })
      .catch(() => setHasPin(false));
  }, [unlocked, firstRun]);

  if (unlocked) return <>{children}</>;

  const unlock = async () => {
    setBusy(true);
    setError(null);
    try {
      await deviceKeeper.unlock(pin || undefined);
      setPin('');
    } catch (e) {
      setError(e instanceof WrongPinError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
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
        {hasPin && (
          <input
            className={shell.input}
            type="password"
            inputMode="numeric"
            autoComplete="current-password"
            placeholder="Device PIN"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void unlock()}
            data-testid="unlock-pin"
            autoFocus
          />
        )}
        <button
          type="button"
          className={shell.btn}
          onClick={() => void unlock()}
          disabled={busy || hasPin === null || (hasPin && !pin)}
          data-testid="unlock"
        >
          {busy ? 'Unlocking…' : 'Unlock'}
        </button>
      </div>
    </section>
  );
}
