import { useCallback, useEffect, useState } from 'react';
import { useMero } from '@calimero-network/mero-react';

import AppHeader from '../../components/AppHeader';
import LockGate from '../../components/LockGate';
import {
  AUTO_LOCK_CHOICES,
  useAutoLockMinutes,
} from '../../hooks/useDeviceLock';
import { deviceKeeper } from '../../lib/deviceKey';
import shell from '../../styles/shell.module.css';

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
 *   * this BROWSER's key — what vault keys are wrapped to. A PIN puts it
 *     behind something you know; auto-lock drops it from memory.
 *   * the ACCOUNT's node devices — each a machine that can sign as you in a
 *     team. Revoking one here withdraws it from every team it is bound in;
 *     an admin revocation also rotates that team's key.
 */
export default function SecurityPage() {
  const { mero } = useMero();
  const [minutes, setMinutes] = useAutoLockMinutes();
  const [hasPin, setHasPin] = useState<boolean | null>(null);
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const [devices, setDevices] = useState<NodeDevice[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setHasPin(await deviceKeeper.hasPin().catch(() => false));
    if (!mero) return;
    try {
      setDevices((await mero.admin.listAccountDevices()) as NodeDevice[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [mero]);

  useEffect(() => {
    void load();
  }, [load]);

  const savePin = async () => {
    setError(null);
    if (pin !== pin2) return setError('The two PINs do not match.');
    try {
      await deviceKeeper.setPin(pin);
      setPin('');
      setPin2('');
      setStatus(
        'PIN set. This browser has a new device key: open each vault once so it registers, and a member who holds the key will hand it over.',
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
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
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className={shell.root}>
      <AppHeader back={{ label: 'Teams', to: '/teams' }} crumb="Security" />
      <main className={shell.main}>
        <h1 className={shell.title}>Security</h1>
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
              {hasPin
                ? 'is protected by a PIN: nothing usable is stored on disk.'
                : 'is stored non-extractable in this browser. Add a PIN so unlocking needs something you know.'}
            </p>
            {!hasPin && (
              <div className={shell.createRow}>
                <input
                  className={shell.input}
                  type="password"
                  placeholder="New PIN (4+ characters)"
                  value={pin}
                  onChange={(e) => setPin(e.target.value)}
                />
                <input
                  className={shell.input}
                  type="password"
                  placeholder="Repeat PIN"
                  value={pin2}
                  onChange={(e) => setPin2(e.target.value)}
                />
                <button
                  type="button"
                  className={shell.btn}
                  onClick={() => void savePin()}
                  disabled={pin.length < 4}
                >
                  Set PIN
                </button>
              </div>
            )}
          </section>
        </LockGate>

        <section className={shell.section}>
          <h2 className={shell.sectionLabel}>Your node devices</h2>
          <p className={shell.sectionHint}>
            Machines that sign as your account. Revoke one you lost; then open
            each vault as an Admin, or ask one to, so its key rotates.
          </p>
          {devices.length === 0 && (
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
