import { useState } from 'react';

import {
  type DeviceRecord,
  type VaultSession,
  confirmationCode,
} from '../lib/vaultSession';
import shell from '../styles/shell.module.css';
import { describeError } from '../lib/errors';

/**
 * Requests from new devices for this vault's key, for a device that may
 * answer them: another browser of the same account, or an admin.
 *
 * The code is the check: the requesting browser shows the same one, so an
 * approver compares the two instead of trusting a label anyone could choose.
 */
export default function DeviceApprovals({
  session,
  requests,
  me,
  onChanged,
}: {
  session: VaultSession;
  requests: DeviceRecord[];
  me: string | undefined;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (requests.length === 0) return null;

  const act = async (d: DeviceRecord, fn: () => Promise<unknown>) => {
    setBusy(d.fingerprint);
    setError(null);
    try {
      await fn();
      onChanged();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className={shell.attention} data-testid="device-approvals">
      <h3 className={shell.sectionLabel}>Devices asking for this vault</h3>
      <p className={shell.sectionHint}>
        Approve only a device you recognise, showing the same code. Approving
        gives it every key of this vault, old ones included.
      </p>
      {error && <p className={shell.error}>{error}</p>}
      {requests.map((d) => (
        <div
          key={d.fingerprint}
          className={shell.row}
          data-testid="device-request"
        >
          <div className={shell.rowMain}>
            <div className={shell.rowName}>
              {d.label || 'Browser'}{' '}
              <span className={shell.badge}>
                code{' '}
                <span className={shell.mono}>
                  {confirmationCode(d.fingerprint)}
                </span>
              </span>
            </div>
            <div className={shell.rowSub}>
              {d.account === me
                ? 'your account'
                : `account ${d.account.slice(0, 10)}…`}{' '}
              · registered {new Date(d.added_at / 1e6).toLocaleString()}
            </div>
          </div>
          <div className={shell.rowActions}>
            <button
              type="button"
              className={shell.btn}
              disabled={busy !== null}
              onClick={() => void act(d, () => session.approve(d))}
              data-testid="approve-device"
            >
              Approve
            </button>
            <button
              type="button"
              className={shell.btnGhost}
              disabled={busy !== null}
              onClick={() => void act(d, () => session.deny(d))}
            >
              Deny
            </button>
          </div>
        </div>
      ))}
    </section>
  );
}
