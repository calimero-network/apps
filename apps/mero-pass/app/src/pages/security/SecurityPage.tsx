import { useCallback, useEffect, useMemo, useState } from 'react';
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
import {
  AlertTriangleIcon,
  CheckIcon,
  ClockIcon,
  KeyIcon,
  LockIcon,
  ServerIcon,
  ShieldIcon,
} from '../../components/icons';

function PanelHead({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className={shell.panelHead}>
      <span
        className={`${shell.rowIcon} ${shell.rowIconSquare}`}
        aria-hidden="true"
      >
        {icon}
      </span>
      <div>
        <h2 className={shell.panelTitle}>{title}</h2>
        {children && <p className={shell.panelText}>{children}</p>}
      </div>
    </div>
  );
}

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
  // `admin` is the session-aware client; `mero.rpc` is what executes on each
  // vault's contract. On an account they are two objects (see `lib/vaults`
  // `VaultMero`), so the whole-account walks below take them apart.
  const { mero, admin, isDelegated } = useMero();
  const vaultMero = useMemo(
    () => (mero && admin ? { admin, rpc: mero.rpc } : null),
    [mero, admin],
  );
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
    if (!admin) return;
    // An account's devices are the wallet's to list, not a node's: the account
    // admin refuses `listAccountDevices` by name (a node-only operation), so
    // the list is not asked for and the section says where to look instead.
    if (isDelegated) {
      setDevices([]);
      setDevicesHidden(true);
      return;
    }
    try {
      setDevices((await admin.listAccountDevices()) as NodeDevice[]);
      setDevicesHidden(false);
    } catch (e) {
      if (/403|forbidden/i.test(rawReason(e))) setDevicesHidden(true);
      else setError(describeError(e));
    }
  }, [admin, isDelegated]);

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
    if (!vaultMero || !appId || !old || !oldFp) return;
    try {
      let moved = 0;
      const handOver = async (
        next: NonNullable<typeof old>,
        nextFp: string,
      ) => {
        moved = await migrateDevice(
          vaultMero,
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
    if (!vaultMero || !appId || !device || !fingerprint) return;
    try {
      const { code, vaults } = await setUpRecoveryKey(
        vaultMero,
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
    if (!vaultMero || !appId || !device || !fingerprint) return;
    try {
      const n = await restoreFromRecoveryKey(
        vaultMero,
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
    if (!admin) return;
    setError(null);
    try {
      for (const ns of d.namespaces) {
        await admin.revokeAccountDevice(ns, { deviceId: d.deviceId });
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
        <div className={shell.titleRow}>
          <span className={shell.titleIcon} aria-hidden="true">
            <ShieldIcon size={22} />
          </span>
          <div>
            <h1 className={shell.title}>Security</h1>
            <p className={shell.subtitle}>
              How this browser guards its key, how you get back in if you lose
              it, and which machines can sign as you.
            </p>
          </div>
        </div>
        {error && (
          <p className={shell.error}>
            <AlertTriangleIcon size={16} />
            <span>{error}</span>
          </p>
        )}
        {status && (
          <p className={shell.notice}>
            <CheckIcon size={16} />
            <span>{status}</span>
          </p>
        )}

        <section className={shell.panel}>
          <PanelHead icon={<ClockIcon size={16} />} title="Auto-lock">
            Clears every vault key from memory after this long without input.
            Copied passwords are cleared from the clipboard after 30 seconds
            regardless.
          </PanelHead>
          <select
            className={shell.input}
            value={minutes}
            onChange={(e) => setMinutes(Number(e.target.value))}
            aria-label="Auto-lock after"
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
          <section className={shell.panel}>
            <PanelHead icon={<LockIcon size={16} />} title="This browser">
              Key{' '}
              <span className={shell.mono}>
                {deviceKeeper.fingerprint?.slice(0, 16)}…
              </span>{' '}
              {protection === 'passphrase'
                ? 'is sealed under a passphrase: nothing usable is stored on disk.'
                : protection === 'passkey'
                  ? 'is sealed under a passkey: unlocking needs your authenticator.'
                  : 'is stored non-extractable in this browser, and anyone at this computer can unlock it. Protect it with a passkey or a passphrase.'}
            </PanelHead>
            <div className={shell.createRow}>
              <button
                type="button"
                className={shell.btn}
                onClick={() => void protect('passkey')}
                data-testid="use-passkey"
              >
                <KeyIcon size={16} />
                {protection === 'passkey'
                  ? 'Use a new passkey'
                  : 'Use a passkey'}
              </button>
            </div>
            <div className={shell.createRow} style={{ marginBottom: 0 }}>
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

          <section className={shell.panel}>
            <PanelHead icon={<KeyIcon size={16} />} title="Recovery key">
              A code that opens every vault it was given, from a browser that
              has nothing else. Write it down or keep it in another password
              manager: whoever reads it can do the same.
            </PanelHead>
            <p
              className={recovery ? shell.notice : shell.warn}
              data-testid="recovery-state"
            >
              {recovery ? (
                <CheckIcon size={16} />
              ) : (
                <AlertTriangleIcon size={16} />
              )}
              <span>
                {recovery
                  ? `One is set up (${recovery.fingerprint.slice(0, 12)}…); vaults you open here get it automatically. Creating a new one replaces it in every vault.`
                  : 'None is set up from this browser.'}
              </span>
            </p>
            {shownCode ? (
              <div data-testid="recovery-code">
                <p className={shell.warn}>
                  <AlertTriangleIcon size={16} />
                  <span>
                    Shown once. Store it now; it is not kept anywhere.
                  </span>
                </p>
                <pre className={shell.keyBox}>{shownCode}</pre>
                <button
                  type="button"
                  className={shell.btn}
                  onClick={() => setShownCode(null)}
                >
                  <CheckIcon size={16} />I have stored it
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
                  <KeyIcon size={16} />
                  {recovery ? 'Replace recovery key' : 'Create recovery key'}
                </button>
              </div>
            )}
            <div
              className={shell.createRow}
              style={{
                marginBottom: 0,
                marginTop: 16,
                paddingTop: 16,
                borderTop: '1px solid var(--border)',
              }}
            >
              <input
                className={shell.input}
                style={{ fontFamily: 'var(--mono)', fontSize: 13 }}
                placeholder="Recovery code, to restore this browser"
                aria-label="Recovery code"
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

        <section className={shell.panel}>
          <PanelHead icon={<ServerIcon size={16} />} title="Your node devices">
            Machines that sign as your account. Revoke one you lost; then open
            each vault as an Admin, or ask one to, so its key rotates.
          </PanelHead>
          {devicesHidden && (
            <p className={shell.empty} data-testid="devices-hidden">
              {isDelegated
                ? "You are signed in as an account, and an account's devices are managed in the wallet that issued this sign-in, not here."
                : "This sign-in may use its vaults but not manage the node, so the node keeps its device list to itself. Revoke devices from the node's own admin dashboard."}
            </p>
          )}
          {!devicesHidden && devices.length === 0 && (
            <p className={shell.empty}>No devices reported.</p>
          )}
          {devices.length > 0 && (
            <div className={shell.list}>
              {devices.map((d) => (
                <div key={d.deviceId} className={shell.row}>
                  <span className={shell.rowIcon} aria-hidden="true">
                    <ServerIcon size={16} />
                  </span>
                  <div className={shell.rowMain}>
                    <div className={shell.rowName}>
                      <span
                        className={shell.mono}
                        style={{ color: 'var(--text)' }}
                        title={d.deviceId}
                      >
                        {d.deviceId.slice(0, 16)}…
                      </span>
                      {d.isSelf && (
                        <span className={`${shell.badge} ${shell.badgeAccent}`}>
                          This node
                        </span>
                      )}
                      {d.revoked && (
                        <span className={`${shell.badge} ${shell.badgeDanger}`}>
                          Revoked
                        </span>
                      )}
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
                        className={`${shell.btnDanger} ${shell.btnSm}`}
                        onClick={() => void revoke(d)}
                      >
                        Revoke
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
