import { useCallback, useEffect, useState } from 'react';
import { useMero } from '@calimero-network/mero-react';

import type { MeroPassClient } from '../generated/MeroPassClient';
import { deviceKeeper } from '../lib/deviceKey';
import type {
  DeviceRecord,
  MemberRecord,
  VaultSession,
} from '../lib/vaultSession';
import { vaultAudience } from '../lib/vaults';
import shell from '../styles/shell.module.css';
import { describeError } from '../lib/errors';
import { KeyIcon, MonitorIcon, UserIcon } from './icons';

const ROLE_HELP: Record<string, string> = {
  admin: 'can change roles, rotate the key and permanently delete',
  editor: 'can add, edit and trash secrets',
  viewer: 'can read, cannot change anything',
  pending: 'registered a device, not let in yet',
  removed: 'removed — will not be let back in automatically',
};

/**
 * Who can open THIS vault, what they may do, and which devices hold its key.
 *
 * Roles here are the vault's own (Admin / Editor / Viewer), enforced by every
 * peer at merge — distinct from the team roles on the team page, which govern
 * creating vaults and inviting people.
 */
export default function VaultPeople({
  client,
  session,
  team,
  onChanged,
}: {
  client: MeroPassClient;
  session: VaultSession;
  team: { namespaceId: string; vaultId: string } | null;
  onChanged: () => void;
}) {
  // The session-aware admin, for the audience reads below; the raw client's
  // admin would answer 403 on an account and every rotation would run with no
  // audience. See `lib/vaults` `AdminLike`.
  const { admin } = useMero();
  const [members, setMembers] = useState<MemberRecord[]>([]);
  const [devices, setDevices] = useState<DeviceRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [defaultRole, setDefaultRole] = useState(
    session.info?.default_role ?? 'editor',
  );
  const isAdmin = session.isAdmin;
  const me = session.info?.my_account;

  const load = useCallback(async () => {
    try {
      const [m, d] = await Promise.all([
        client.listMembers(),
        client.listDevices(),
      ]);
      setMembers(
        m.map((x) => ({ ...x, role: x.role as MemberRecord['role'] })),
      );
      setDevices(d);
      setError(null);
    } catch (e) {
      setError(describeError(e));
    }
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (label: string, fn: () => Promise<unknown>) => {
    setError(null);
    setStatus(label);
    try {
      await fn();
      await load();
      onChanged();
      setStatus(null);
    } catch (e) {
      setError(describeError(e));
      setStatus(null);
    }
  };

  const rotate = () =>
    act('Rotating the vault key and re-encrypting…', async () => {
      const allowed = admin && team ? await vaultAudience(admin, team) : null;
      const n = await session.rotate(allowed, (done, total) =>
        setStatus(`Re-encrypting ${done} of ${total}…`),
      );
      setStatus(`Rotated. ${n} secrets re-encrypted.`);
    });

  const remove = (account: string) =>
    act('Removing and rotating…', async () => {
      await client.removeMember({ account });
      // `remove_member` already stripped their roles and revoked their devices,
      // so the rotation below skips them even when the team listing is
      // unavailable; the audience narrows it further when it is.
      const allowed = admin && team ? await vaultAudience(admin, team) : null;
      allowed?.delete(account);
      await session.rotate(allowed);
    });

  return (
    <section data-testid="vault-people">
      <h2 className={shell.sectionLabel}>People &amp; devices</h2>
      <p className={shell.sectionHint}>
        The vault key is wrapped to each device below. Removing someone or
        revoking a device rotates the key, so nothing written afterwards is
        readable to them.{' '}
        <strong>What they already saw cannot be taken back</strong> — change
        those passwords.
      </p>
      {error && <p className={shell.error}>{error}</p>}
      {status && (
        <p className={shell.status}>
          <span className={shell.spinner} aria-hidden="true" />
          <span>{status}</span>
        </p>
      )}

      <h3 className={shell.sectionLabel}>People</h3>
      <div className={shell.list}>
        {members.map((m) => (
          <div key={m.account} className={shell.row} data-testid="vault-member">
            <span className={shell.rowIcon} aria-hidden="true">
              <UserIcon size={16} />
            </span>
            <div className={shell.rowMain}>
              <div className={shell.rowName}>
                <span className={shell.mono} style={{ color: 'var(--text)' }}>
                  {m.account.slice(0, 16)}…
                </span>
                {m.account === me && <span className={shell.you}>(you)</span>}
                <span
                  className={`${shell.badge} ${m.role === 'admin' ? shell.badgeAccent : m.role === 'pending' ? shell.badgeWarn : m.role === 'removed' ? shell.badgeDanger : ''}`}
                >
                  {m.role.charAt(0).toUpperCase() + m.role.slice(1)}
                </span>
              </div>
              <div className={shell.rowSub}>
                {ROLE_HELP[m.role] ?? ''} · {m.devices} device
                {m.devices === 1 ? '' : 's'}
              </div>
            </div>
            {isAdmin && m.account !== me && (
              <div className={shell.rowActions}>
                <select
                  className={shell.input}
                  value={
                    m.role === 'pending' || m.role === 'removed' ? '' : m.role
                  }
                  onChange={(e) =>
                    void act('Changing role…', () =>
                      client.setRole({
                        account: m.account,
                        role: e.target.value,
                      }),
                    )
                  }
                  aria-label="Role"
                >
                  <option value="" disabled>
                    Set role…
                  </option>
                  <option value="viewer">Viewer</option>
                  <option value="editor">Editor</option>
                  <option value="admin">Admin</option>
                </select>
                {m.role !== 'removed' && (
                  <button
                    type="button"
                    className={`${shell.btnDanger} ${shell.btnSm}`}
                    onClick={() => void remove(m.account)}
                    data-testid="vault-remove"
                  >
                    Remove
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      <h3 className={shell.sectionLabel}>Devices holding the key</h3>
      <div className={shell.list}>
        {devices.map((d) => {
          const mine = d.fingerprint === deviceKeeper.fingerprint;
          return (
            <div
              key={d.fingerprint}
              className={shell.row}
              data-testid="vault-device"
            >
              <span
                className={`${shell.rowIcon} ${shell.rowIconSquare}`}
                aria-hidden="true"
              >
                <MonitorIcon size={16} />
              </span>
              <div className={shell.rowMain}>
                <div className={shell.rowName}>
                  {d.label || 'Browser'}
                  {mine && <span className={shell.you}>(this browser)</span>}
                  {d.revoked && (
                    <span className={`${shell.badge} ${shell.badgeDanger}`}>
                      Revoked
                    </span>
                  )}
                </div>
                <div className={shell.rowSub}>
                  <span className={shell.mono}>
                    {d.fingerprint.slice(0, 16)}…
                  </span>{' '}
                  · {d.account === me ? 'yours' : `${d.account.slice(0, 10)}…`}
                </div>
              </div>
              {!d.revoked && (isAdmin || d.account === me) && (
                <div className={shell.rowActions}>
                  <button
                    type="button"
                    className={`${shell.btnGhost} ${shell.btnSm}`}
                    onClick={() =>
                      void act('Revoking…', async () => {
                        await client.revokeDevice({
                          fingerprint: d.fingerprint,
                        });
                        if (isAdmin) {
                          const allowed =
                            admin && team
                              ? await vaultAudience(admin, team)
                              : null;
                          await session.rotate(allowed);
                        }
                      })
                    }
                  >
                    Revoke
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {isAdmin && (
        <div className={shell.panel} style={{ marginTop: 28 }}>
          <div className={shell.panelHead}>
            <span
              className={`${shell.rowIcon} ${shell.rowIconSquare}`}
              aria-hidden="true"
            >
              <KeyIcon size={16} />
            </span>
            <div>
              <h3 className={shell.panelTitle}>Admin</h3>
              <p className={shell.panelText}>
                The role newcomers get, and a manual key rotation.
              </p>
            </div>
          </div>
          <div className={shell.createRow} style={{ marginBottom: 0 }}>
            <label className={shell.checkLabel} htmlFor="default-role">
              Newcomers join as
            </label>
            <select
              id="default-role"
              className={shell.input}
              value={defaultRole}
              onChange={(e) => {
                const role = e.target.value;
                setDefaultRole(role);
                void act('Saving…', () => client.setDefaultRole({ role }));
              }}
            >
              <option value="editor">Editor</option>
              <option value="viewer">Viewer</option>
            </select>
            <button
              type="button"
              className={shell.btnGhost}
              onClick={() => void rotate()}
              style={{ marginLeft: 'auto' }}
            >
              <KeyIcon size={16} />
              Rotate vault key
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
