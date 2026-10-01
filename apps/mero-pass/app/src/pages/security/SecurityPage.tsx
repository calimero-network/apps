import { useCallback, useEffect, useState } from 'react';
import { useMero } from '@calimero-network/mero-react';

import AppHeader from '../../components/AppHeader';
import LockGate from '../../components/LockGate';
import {
  AUTO_LOCK_CHOICES,
  useAutoLockMinutes,
} from '../../hooks/useDeviceLock';
import { useApplicationId } from '../../hooks/useApplicationId';
import {
  MIN_PASSPHRASE,
  type Protection,
  deviceKeeper,
  deviceLabel,
} from '../../lib/deviceKey';
import {
  rememberedRecoveryKey,
  restoreFromRecoveryKey,
  setUpRecoveryKey,
} from '../../lib/recoveryKey';
import { migrateDevice } from '../../lib/vaults';
import shell from '../../styles/shell.module.css';
import { describeError, rawReason } from '../../lib/errors';

interface NodeDevice {
  deviceId: string;
  isSelf: boolean;
  revoked: boolean;
  namespaces: string[];
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
 *   * the ACCOUNT's node devices — each a machine that can sign as you in a
 *     team. Revoking one here withdraws it from every team it is bound in;
 *     an admin revocation also rotates that team's key.
 */
export default function SecurityPage() {
  const { mero } = useMero();
  const { appId } = useApplicationId();
  const [minutes, setMinutes] = useAutoLockMinutes();
  const [protection, setProtection] = useState<Protection | null>(null);
  const [pass, setPass] = useState('');
  const [pass2, setPass2] = useState('');
  const [recovery, setRecovery] = useState(rememberedRecoveryKey);
  const [shownCode, setShownCode] = useState<string | null>(null);
  const [restoreCode, setRestoreCode] = useState('');
  const [devices, setDevices] = useState<NodeDevice[]>([]);
  // The node lists its account's devices only to a session with admin scope.
  // A browser signed in for this app alone is refused with a 403; that is the
  // node working as intended, so it reads as a note, not an error.
  const [devicesHidden, setDevicesHidden] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setProtection(await deviceKeeper.protection().catch(() => 'none' as const));
    if (!mero) return;
    try {
      setDevices((await mero.admin.listAccountDevices()) as NodeDevice[]);
      setDevicesHidden(false);
    } catch (e) {
      if (/403|forbidden/i.test(rawReason(e))) setDevicesHidden(true);
      else setError(describeError(e));
    }
  }, [mero]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Re-seal this browser's key; every vault key moves to the new one first. */
  const protect = async (how: 'passphrase' | 'passkey') => {
    setError(null);
    if (how === 'passphrase' && pass !== pass2)
      return setError('The two passphrases do not match.');
    const old = deviceKeeper.device;
    const oldFp = deviceKeeper.fingerprint;
    if (!mero || !appId || !old || !oldFp) return;
    try {
      let moved = 0;
      const handOver = async (
        next: NonNullable<typeof old>,
        nextFp: string,
      ) => {
        moved = await migrateDevice(
          mero,
          appId,
          { device: old, fingerprint: oldFp },
          { device: next, fingerprint: nextFp },
          deviceLabel(),
          setStatus,
        );
      };
      if (how === 'passphrase')
        await deviceKeeper.setPassphrase(pass, handOver);
      else await deviceKeeper.setPasskey(handOver);
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
    const device = deviceKeeper.device;
    const fingerprint = deviceKeeper.fingerprint;
    if (!mero || !appId || !device || !fingerprint) return;
    try {
      const { code, vaults } = await setUpRecoveryKey(
        mero,
        appId,
        { device, fingerprint },
        deviceLabel(),
        (v) => setStatus(`Giving the recovery key ${v}`),
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
    const device = deviceKeeper.device;
    const fingerprint = deviceKeeper.fingerprint;
    if (!mero || !appId || !device || !fingerprint) return;
    try {
      const n = await restoreFromRecoveryKey(
        mero,
        appId,
        restoreCode,
        { device, fingerprint },
        deviceLabel(),
        (v) => setStatus(`Restoring ${v}`),
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

  const revoke = async (d: NodeDevice) => {
    if (!mero) return;
    setError(null);
    try {
      for (const ns of d.namespaces) {
        await mero.admin.revokeAccountDevice(ns, { deviceId: d.deviceId });
      }
      setStatus(
        `Device ${d.deviceId.slice(0, 10)}… revoked in ${d.namespaces.length} team(s).`,
      );
      await load();
    } catch (e) {
      setError(describeError(e));
    }
  };

  return (
    <div className={shell.root}>
      <AppHeader back={{ label: 'Teams', to: '/teams' }} crumb="Security" />
      <main className={shell.main}>
        <p className={shell.eyebrow}>This browser</p>
        <h1 className={shell.title}>Security</h1>
        <p className={shell.subtitle}>
          How this browser guards its key, how you get back in if you lose it,
          and which machines can sign as you.
        </p>
        {error && <p className={shell.error}>{error}</p>}
        {status && <p className={shell.notice}>{status}</p>}

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
          <h2 className={shell.sectionLabel}>Your node devices</h2>
          <p className={shell.sectionHint}>
            Machines that sign as your account. Revoke one you lost; then open
            each vault as an Admin, or ask one to, so its key rotates.
          </p>
          {devicesHidden && (
            <p className={shell.empty} data-testid="devices-hidden">
              This sign-in may use its vaults but not manage the node, so the
              node keeps its device list to itself. Revoke devices from the
              node's own admin dashboard.
            </p>
          )}
          {!devicesHidden && devices.length === 0 && (
            <p className={shell.empty}>No devices reported.</p>
          )}
          {devices.map((d) => (
            <div key={d.deviceId} className={shell.row}>
              <div className={shell.rowMain}>
                <div className={shell.rowName}>
                  <span className={shell.mono}>{d.deviceId.slice(0, 16)}…</span>
                  {d.isSelf ? ' (this node)' : ''}{' '}
                  {d.revoked && <span className={shell.badge}>revoked</span>}
                </div>
                <div className={shell.rowSub}>
                  bound in {d.namespaces.length} team
                  {d.namespaces.length === 1 ? '' : 's'}
                </div>
              </div>
              {!d.isSelf && !d.revoked && d.namespaces.length > 0 && (
                <div className={shell.rowActions}>
                  <button
                    type="button"
                    className={shell.btnDanger}
                    onClick={() => void revoke(d)}
                  >
                    Revoke
                  </button>
                </div>
              )}
            </div>
          ))}
        </section>
      </main>
    </div>
  );
}
