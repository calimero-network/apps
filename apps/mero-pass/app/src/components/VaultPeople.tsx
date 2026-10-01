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
  const { mero } = useMero();
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
      const allowed =
        mero && team ? await vaultAudience(mero.admin, team) : null;
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
      const allowed =
        mero && team ? await vaultAudience(mero.admin, team) : null;
      allowed?.delete(account);
      await session.rotate(allowed);
    });

  return (
    <section data-testid="vault-people">
      <p className={shell.sectionHint}>
        The vault key is wrapped to each device below. Removing someone or
        revoking a device rotates the key, so nothing written afterwards is
        readable to them.{' '}
        <strong>What they already saw cannot be taken back</strong> — change
        those passwords.
      </p>
      {error && <p className={shell.error}>{error}</p>}
      {status && <p className={shell.status}>{status}</p>}

      <h3 className={shell.sectionLabel}>People</h3>
      {members.map((m) => (
        <div key={m.account} className={shell.row} data-testid="vault-member">
          <div className={shell.rowMain}>
            <div className={shell.rowName}>
              <span className={shell.mono}>{m.account.slice(0, 16)}…</span>
              {m.account === me ? ' (you)' : ''}{' '}
              <span
                className={`${shell.badge} ${m.role === 'admin' ? shell.badgeAccent : ''}`}
              >
                {m.role}
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
                  className={shell.btnDanger}
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

      <h3 className={shell.sectionLabel}>Devices holding the key</h3>
      {devices.map((d) => {
        const mine = d.fingerprint === deviceKeeper.fingerprint;
        return (
          <div
            key={d.fingerprint}
            className={shell.row}
            data-testid="vault-device"
          >
            <div className={shell.rowMain}>
              <div className={shell.rowName}>
                {d.label || 'Browser'}
                {mine ? ' (this browser)' : ''}{' '}
                {d.revoked && <span className={shell.badge}>revoked</span>}
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
                  className={shell.btnGhost}
                  onClick={() =>
                    void act('Revoking…', async () => {
                      await client.revokeDevice({ fingerprint: d.fingerprint });
                      if (isAdmin) {
                        const allowed =
                          mero && team
                            ? await vaultAudience(mero.admin, team)
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

      {isAdmin && (
        <div className={shell.section}>
          <h3 className={shell.sectionLabel}>Admin</h3>
          <div className={shell.createRow}>
            <label className={shell.rowSub} htmlFor="default-role">
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
            >
              Rotate vault key
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
