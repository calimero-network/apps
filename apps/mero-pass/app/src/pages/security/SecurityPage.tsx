import { useCallback, useEffect, useState } from 'react';

import { useSignOut } from '../../auth/signOut';
import { useCalimero } from '../../calimero';
import AppShell from '../../components/AppShell';
import LockGate from '../../components/LockGate';
import { LogOutIcon } from '../../components/icons';
import {
  AUTO_LOCK_CHOICES,
  useAutoLockMinutes,
} from '../../hooks/useDeviceLock';
import { useDeviceSetup } from '../../hooks/useDeviceSetup';
import {
  MIN_PASSPHRASE,
  type Protection,
  deviceKeeper,
} from '../../lib/deviceKey';
import { rememberedRecoveryKey } from '../../lib/recoveryKey';
import { type ThemeMode, chooseTheme, useTheme } from '../../lib/theme';
import shell from '../../styles/shell.module.css';
import { describeError } from '../../lib/errors';
import { passkeyConfirm } from '@calimero-network/mero-js';

/** One passkey of the signed-in account (`GET /me`). */
interface Passkey {
  id: string;
  label: string | null;
  isSelf: boolean;
}

/**
 * This browser's lock, and the node-level devices of this account.
 *
 * Two kinds of device, deliberately shown together:
 *
 *   * this BROWSER's key — what vault keys are wrapped to. A passphrase or a
 *     passkey puts it behind something you know or touch; auto-lock drops it
 *     from memory. A recovery key is one more holder of every vault key,
 *     kept on paper, that brings a browser with nothing back.
 *   * the ACCOUNT's passkeys: each a device that can sign in as you.
 *     Removing one ends what it can do from then on (it is a passkey
 *     step-up, approved with one you keep).
 */
export default function SecurityPage() {
  const { client, where, passkey, after } = useCalimero();
  const nodeUrl = where;
  const signOut = useSignOut();
  const theme = useTheme();
  const {
    protect: reseal,
    createRecovery: makeRecovery,
    restoreRecovery,
  } = useDeviceSetup();
  const [minutes, setMinutes] = useAutoLockMinutes();
  const [protection, setProtection] = useState<Protection | 'missing' | null>(
    null,
  );
  const [pass, setPass] = useState('');
  const [pass2, setPass2] = useState('');
  const [recovery, setRecovery] = useState(rememberedRecoveryKey);
  const [shownCode, setShownCode] = useState<string | null>(null);
  const [restoreCode, setRestoreCode] = useState('');
  const [devices, setDevices] = useState<Passkey[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setProtection(await deviceKeeper.protection().catch(() => 'none' as const));
    if (!client) return;
    try {
      const me = (await client.auth.me()) as {
        passkeys?: Array<{ id: string; label?: string | null }>;
        passkeyId?: string | null;
      };
      setDevices(
        (me.passkeys ?? []).map((k) => ({
          id: k.id,
          label: k.label ?? null,
          isSelf: k.id === me.passkeyId,
        })),
      );
    } catch (e) {
      setError(describeError(e));
    } finally {
      after();
    }
  }, [client, after]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Re-seal this browser's key; every vault key moves to the new one first. */
  const protect = async (how: 'passphrase' | 'passkey') => {
    setError(null);
    if (how === 'passphrase' && pass !== pass2)
      return setError('The two passphrases do not match.');
    try {
      const moved = await reseal(how, pass, setStatus);
      setPass('');
      setPass2('');
      setStatus(
        `${how === 'passphrase' ? 'Passphrase' : 'Passkey'} set. ${moved} vault key(s) moved to this browser's new device key.`,
      );
      await load();
    } catch (e) {
      setError(describeError(e));
    }
  };

  const createRecovery = async () => {
    setError(null);
    try {
      const { code, vaults } = await makeRecovery((v) =>
        setStatus(`Giving the recovery key ${v}`),
      );
      setShownCode(code);
      setRecovery(rememberedRecoveryKey());
      setStatus(`Recovery key created for ${vaults} vault(s).`);
    } catch (e) {
      setError(describeError(e));
    }
  };

  const restore = async () => {
    setError(null);
    try {
      const n = await restoreRecovery(restoreCode, (v) =>
        setStatus(`Restoring ${v}`),
      );
      setRestoreCode('');
      setRecovery(rememberedRecoveryKey());
      setStatus(
        `${n} vault(s) restored to this browser. Revoke the device you lost in each vault's People tab.`,
      );
    } catch (e) {
      setError(describeError(e));
    }
  };

  const revoke = async (d: Passkey) => {
    if (!client) return;
    setError(null);
    try {
      await client.auth.passkeyRemove(
        { cred: d.id },
        { confirm: passkeyConfirm(passkey()) },
      );
      setStatus(`Passkey ${d.label ?? d.id.slice(0, 10) + '…'} removed.`);
      await load();
    } catch (e) {
      setError(describeError(e));
    } finally {
      after();
    }
  };

  return (
    <AppShell crumb="Security">
      <main className={shell.main}>
        <p className={shell.eyebrow}>This browser</p>
        <h1 className={shell.title}>Security</h1>
        <p className={shell.subtitle}>
          How this browser guards its key, how you get back in if you lose it,
          and which devices can sign in as you.
        </p>
        {error && <p className={shell.error}>{error}</p>}
        {status && <p className={shell.notice}>{status}</p>}

        <section className={shell.section}>
          <h2 className={shell.sectionLabel}>Appearance</h2>
          <p className={shell.sectionHint}>
            Light is the default. The choice is kept in this browser only.
          </p>
          <div
            className={shell.tabs}
            role="radiogroup"
            aria-label="Appearance"
            style={{ marginBottom: 0 }}
          >
            {(['light', 'dark'] as ThemeMode[]).map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={theme === m}
                className={`${shell.tab} ${theme === m ? shell.tabActive : ''}`}
                onClick={() => chooseTheme(m)}
                data-testid={`appearance-${m}`}
              >
                {m === 'light' ? 'Light' : 'Dark'}
              </button>
            ))}
          </div>
        </section>

        <section className={shell.section}>
          <h2 className={shell.sectionLabel}>Auto-lock</h2>
          <p className={shell.sectionHint}>
            Clears every vault key from memory after this long without input.
            Copied passwords are cleared from the clipboard after 30 seconds
            regardless.
          </p>
          <select
            className={shell.input}
            value={minutes}
            onChange={(e) => setMinutes(Number(e.target.value))}
            data-testid="auto-lock"
          >
            {AUTO_LOCK_CHOICES.map((m) => (
              <option key={m} value={m}>
                {m === 60 ? '1 hour' : `${m} minute${m === 1 ? '' : 's'}`}
              </option>
            ))}
          </select>
        </section>

        <LockGate>
          <section className={shell.section}>
            <h2 className={shell.sectionLabel}>This browser</h2>
            <p className={shell.sectionHint}>
              Key{' '}
              <span className={shell.mono}>
                {deviceKeeper.fingerprint?.slice(0, 16)}…
              </span>{' '}
              {protection === 'passphrase'
                ? 'is sealed under a passphrase: nothing usable is stored on disk.'
                : protection === 'passkey'
                  ? 'is sealed under a passkey: unlocking needs your authenticator.'
                  : 'is stored non-extractable in this browser, and anyone at this computer can unlock it. Protect it with a passkey or a passphrase.'}
            </p>
            <div className={shell.createRow}>
              <button
                type="button"
                className={shell.btn}
                onClick={() => void protect('passkey')}
                data-testid="use-passkey"
              >
                {protection === 'passkey'
                  ? 'Use a new passkey'
                  : 'Use a passkey'}
              </button>
            </div>
            <div className={shell.createRow}>
              <input
                className={shell.input}
                type="password"
                autoComplete="new-password"
                placeholder={`Passphrase (${MIN_PASSPHRASE}+ characters)`}
                value={pass}
                onChange={(e) => setPass(e.target.value)}
              />
              <input
                className={shell.input}
                type="password"
                autoComplete="new-password"
                placeholder="Repeat passphrase"
                value={pass2}
                onChange={(e) => setPass2(e.target.value)}
              />
              <button
                type="button"
                className={shell.btnGhost}
                onClick={() => void protect('passphrase')}
                disabled={pass.length < MIN_PASSPHRASE}
                data-testid="use-passphrase"
              >
                {protection === 'passphrase'
                  ? 'Change passphrase'
                  : 'Use a passphrase'}
              </button>
            </div>
          </section>

          <section className={shell.section}>
            <h2 className={shell.sectionLabel}>Recovery key</h2>
            <p className={shell.sectionHint}>
              A code that opens every vault it was given, from a browser that
              has nothing else. Write it down or keep it in another password
              manager: whoever reads it can do the same.{' '}
              {recovery
                ? `One is set up (${recovery.fingerprint.slice(0, 12)}…); vaults you open here get it automatically. Creating a new one replaces it in every vault.`
                : 'None is set up from this browser.'}
            </p>
            {shownCode ? (
              <div data-testid="recovery-code">
                <p className={shell.notice}>
                  Shown once. Store it now; it is not kept anywhere.
                </p>
                <pre className={shell.keyBox}>{shownCode}</pre>
                <button
                  type="button"
                  className={shell.btn}
                  onClick={() => setShownCode(null)}
                >
                  I have stored it
                </button>
              </div>
            ) : (
              <div className={shell.createRow}>
                <button
                  type="button"
                  className={recovery ? shell.btnGhost : shell.btn}
                  onClick={() => void createRecovery()}
                  data-testid="create-recovery"
                >
                  {recovery ? 'Replace recovery key' : 'Create recovery key'}
                </button>
              </div>
            )}
            <div className={shell.createRow}>
              <input
                className={shell.input}
                placeholder="Recovery code, to restore this browser"
                value={restoreCode}
                onChange={(e) => setRestoreCode(e.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
              <button
                type="button"
                className={shell.btnGhost}
                onClick={() => void restore()}
                disabled={!restoreCode.trim()}
                data-testid="restore-recovery"
              >
                Restore
              </button>
            </div>
          </section>
        </LockGate>

        <section className={shell.section}>
          <h2 className={shell.sectionLabel}>Your passkeys</h2>
          <p className={shell.sectionHint}>
            Devices that can sign in as your account. Remove one you lost
            (confirm with a passkey you keep); then revoke its browser in each
            vault's People tab, or ask an Admin to, so the vault key rotates.
          </p>
          {devices.length === 0 && (
            <p className={shell.empty}>No passkeys reported.</p>
          )}
          {devices.map((d) => (
            <div key={d.id} className={shell.row}>
              <div className={shell.rowMain}>
                <div className={shell.rowName}>
                  {d.label ?? (
                    <span className={shell.mono}>{d.id.slice(0, 16)}…</span>
                  )}
                  {d.isSelf ? ' (this sign-in)' : ''}
                </div>
              </div>
              {!d.isSelf && devices.length > 1 && (
                <div className={shell.rowActions}>
                  <button
                    type="button"
                    className={shell.btnDanger}
                    onClick={() => void revoke(d)}
                  >
                    Remove
                  </button>
                </div>
              )}
            </div>
          ))}
        </section>

        <section className={shell.section} data-testid="account-section">
          <h2 className={shell.sectionLabel}>Your account</h2>
          <p className={shell.sectionHint}>
            Signed in to{' '}
            <span className={shell.mono}>{nodeUrl || 'Calimero'}</span>. Logging
            out locks every vault key in this tab, clears a copied password from
            the clipboard and ends the session. This browser's device key stays
            on this device, locked, so its vaults open again after you sign back
            in and unlock.
          </p>
          <button
            type="button"
            className={shell.btnDanger}
            onClick={signOut}
            data-testid="settings-logout"
          >
            <LogOutIcon size={15} /> Log out
          </button>
        </section>
      </main>
    </AppShell>
  );
}
