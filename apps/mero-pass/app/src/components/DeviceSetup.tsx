import { useState } from 'react';
import { Lock } from '@calimero-network/mero-icons';

import { useDeviceSetup } from '../hooks/useDeviceSetup';
import { MIN_PASSPHRASE } from '../lib/deviceKey';
import { describeError } from '../lib/errors';
import gate from '../styles/gate.module.css';
import shell from '../styles/shell.module.css';

/**
 * Seal this browser's key under a passkey or a passphrase. Required: the lock
 * screen shows nothing else until it is done.
 *
 * `fresh` is a browser with no key yet, whose first key is made sealed. A
 * browser holding an unprotected key from before gets a new sealed one, and
 * every vault key moves onto it first (`useDeviceSetup().protect`).
 */
export function ProtectStep({
  fresh,
  onDone,
}: {
  fresh: boolean;
  onDone: () => void;
}) {
  const { ready, protect } = useDeviceSetup();
  const [pass, setPass] = useState('');
  const [pass2, setPass2] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const waiting = !fresh && !ready;

  const run = async (how: 'passphrase' | 'passkey') => {
    setError(null);
    if (how === 'passphrase' && pass !== pass2)
      return setError('The two passphrases do not match.');
    setBusy(true);
    try {
      await protect(how, pass, setStatus);
      setPass('');
      setPass2('');
      onDone();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
      setStatus(null);
    }
  };

  return (
    <section className={gate.gate} data-testid="device-setup">
      <div className={gate.card}>
        <span className={gate.icon} aria-hidden="true">
          <Lock size={28} />
        </span>
        <h2 className={gate.title}>Protect this browser</h2>
        <p className={gate.hint}>
          {fresh
            ? 'Mero Pass keeps a key in this browser that opens your vaults. Seal it under a passkey or a passphrase, so nothing usable is stored on this computer.'
            : "This browser's key is stored unprotected: anyone at this computer can open your vaults. Seal it under a passkey or a passphrase to continue. Your vault keys move to the sealed key."}
        </p>
        {error && <p className={shell.error}>{error}</p>}
        {(status || waiting) && (
          <p className={shell.status}>{status ?? 'Connecting to your node…'}</p>
        )}
        <div className={gate.form}>
          <button
            type="button"
            className={`${shell.btn} ${gate.unlock}`}
            onClick={() => void run('passkey')}
            disabled={busy || waiting}
            data-testid="setup-passkey"
          >
            Use a passkey
          </button>
        </div>
        <p className={gate.hint}>or a passphrase</p>
        <div className={gate.form}>
          <input
            className={shell.input}
            type="password"
            autoComplete="new-password"
            placeholder={`Passphrase (${MIN_PASSPHRASE}+ characters)`}
            aria-label="New passphrase"
            value={pass}
            onChange={(e) => setPass(e.target.value)}
            data-testid="setup-passphrase"
          />
          <input
            className={shell.input}
            type="password"
            autoComplete="new-password"
            placeholder="Repeat passphrase"
            aria-label="Repeat passphrase"
            value={pass2}
            onChange={(e) => setPass2(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void run('passphrase')}
            data-testid="setup-passphrase-repeat"
          />
          <button
            type="button"
            className={`${shell.btnGhost} ${gate.unlock}`}
            onClick={() => void run('passphrase')}
            disabled={busy || waiting || pass.length < MIN_PASSPHRASE}
            data-testid="setup-use-passphrase"
          >
            {busy ? 'Protecting…' : 'Use a passphrase'}
          </button>
        </div>
      </div>
    </section>
  );
}

/** The last group of a recovery code, which the user types back to show it was kept. */
function lastGroup(code: string): string {
  return code.split('-').pop() ?? '';
}

/**
 * Make a recovery key, or prove this browser's owner already has one.
 * Required once per browser: a vault only this browser holds is otherwise
 * lost with it, and nobody can reset it.
 *
 * A code from another browser is checked by using it: every vault it opens
 * is handed to this browser, which is also how a new browser gets back in.
 */
export function RecoveryStep({ onDone }: { onDone: () => void }) {
  const { ready, createRecovery, restoreRecovery } = useDeviceSetup();
  const [code, setCode] = useState<string | null>(null);
  const [confirm, setConfirm] = useState('');
  const [existing, setExisting] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const act = async (fn: () => Promise<void>) => {
    setError(null);
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
      setStatus(null);
    }
  };

  const create = () =>
    act(async () => {
      const made = await createRecovery((v) =>
        setStatus(`Giving the recovery key ${v}`),
      );
      setCode(made.code);
    });

  const restore = () =>
    act(async () => {
      await restoreRecovery(existing, (v) => setStatus(`Checking ${v}`));
      setExisting('');
      onDone();
    });

  const confirmed =
    !!code && confirm.trim().toUpperCase() === lastGroup(code).toUpperCase();

  return (
    <section className={gate.gate} data-testid="recovery-setup">
      <div className={gate.card}>
        <span className={gate.icon} aria-hidden="true">
          <Lock size={28} />
        </span>
        <h2 className={gate.title}>Save a recovery key</h2>
        {code ? (
          <>
            <p className={gate.hint}>
              Shown once. Write it down or keep it in another password manager:
              whoever reads it can open your vaults.
            </p>
            <pre className={shell.keyBox} data-testid="setup-recovery-code">
              {code}
            </pre>
            <div className={gate.form}>
              <input
                className={shell.input}
                placeholder="Type its last 4 characters"
                aria-label="Last 4 characters of the recovery code"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="off"
                spellCheck={false}
                data-testid="setup-recovery-confirm"
              />
              <button
                type="button"
                className={`${shell.btn} ${gate.unlock}`}
                onClick={onDone}
                disabled={!confirmed}
                data-testid="setup-recovery-done"
              >
                I have stored it
              </button>
            </div>
          </>
        ) : (
          <>
            <p className={gate.hint}>
              If this browser is wiped or lost, a recovery code is the way back
              into vaults only you hold. Nobody can reset it for you, Calimero
              included.
            </p>
            {error && <p className={shell.error}>{error}</p>}
            {(status || !ready) && (
              <p className={shell.status}>
                {status ?? 'Connecting to your node…'}
              </p>
            )}
            <div className={gate.form}>
              <button
                type="button"
                className={`${shell.btn} ${gate.unlock}`}
                onClick={() => void create()}
                disabled={busy || !ready}
                data-testid="setup-create-recovery"
              >
                Create recovery key
              </button>
            </div>
            <p className={gate.hint}>
              Already made one in another browser? Enter it here instead.
            </p>
            <div className={gate.form}>
              <input
                className={shell.input}
                placeholder="Recovery code"
                aria-label="Existing recovery code"
                value={existing}
                onChange={(e) => setExisting(e.target.value)}
                autoComplete="off"
                spellCheck={false}
                data-testid="setup-restore-code"
              />
              <button
                type="button"
                className={`${shell.btnGhost} ${gate.unlock}`}
                onClick={() => void restore()}
                disabled={busy || !ready || !existing.trim()}
                data-testid="setup-restore"
              >
                Use this code
              </button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
