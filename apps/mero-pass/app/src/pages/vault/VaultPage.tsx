import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMero } from '@calimero-network/mero-react';
import {
  Clock,
  FileText,
  Lock,
  LockBox,
  LockStar,
  ShieldCheck,
} from '@calimero-network/mero-icons';

import AppHeader from '../../components/AppHeader';
import DeviceApprovals from '../../components/DeviceApprovals';
import HealthPanel from '../../components/HealthPanel';
import ImportExport from '../../components/ImportExport';
import InviteModal from '../../components/InviteModal';
import LockGate from '../../components/LockGate';
import SecretForm from '../../components/SecretForm';
import ShareModal from '../../components/ShareModal';
import TotpCode from '../../components/TotpCode';
import VaultPeople from '../../components/VaultPeople';
import type { AuditView } from '../../generated/MeroPassClient';
import { useApplicationId } from '../../hooks/useApplicationId';
import { useVaultSession } from '../../hooks/useVaultSession';
import { copySecret } from '../../lib/clipboard';
import { deviceKeeper } from '../../lib/deviceKey';
import { isSensitive, isTotpField } from '../../lib/secretKinds';
import { useVaultClient, useVaultName } from '../../lib/vault';
import {
  type Revision,
  type Secret,
  confirmationCode,
} from '../../lib/vaultSession';
import { findVaultByContext, mintVaultInvite } from '../../lib/vaults';
import shell from '../../styles/shell.module.css';
import styles from './vault.module.css';

type Tab = 'secrets' | 'trash' | 'health' | 'people' | 'activity' | 'transfer';

/**
 * Line icons from the Calimero set, one per kind, drawn in the accent-text
 * colour. Not emoji: an emoji is a fixed-colour bitmap that cannot follow the
 * theme.
 */
const KIND_ICON: Record<string, typeof Lock> = {
  login: Lock,
  secure_note: FileText,
  totp: Clock,
  ssh_key: LockStar,
  payment_card: LockBox,
  identity: ShieldCheck,
};

function KindIcon({ kind, size = 16 }: { kind: string; size?: number }) {
  const Icon = KIND_ICON[kind] ?? Lock;
  return <Icon size={size} />;
}

/** Calimero stamps in nanoseconds; anything that large is not milliseconds. */
function asDate(stamp: number): Date {
  return new Date(stamp > 1e12 ? Math.floor(stamp / 1e6) : stamp);
}

function short(account: string, me?: string): string {
  return account && account === me ? 'you' : `${account.slice(0, 10)}…`;
}

interface Found {
  namespaceId: string;
  vaultId: string;
  vaultName: string;
  teamName: string;
  personal: boolean;
}

/**
 * One vault: its secrets, decrypted in this browser, and everything around them.
 *
 * ── What the page can and cannot see ─────────────────────────────────────────
 *
 * Every secret arrives from the node as ciphertext and is opened here with the
 * vault key, which this device receives wrapped to its own public key (see
 * `lib/vaultSession`). So the page has three honest states before a list:
 *
 *   * locked      — the device key is not in memory (auto-lock, or first load
 *                   with a passkey or passphrase). Nothing renders.
 *   * waiting     — this device is registered but nobody holding the key has
 *                   wrapped it to us yet. We can see THAT secrets exist, not
 *                   what they are. When the account already has a browser
 *                   that holds the key, this one waits for that browser (or
 *                   an admin) to approve it, and shows the code to compare.
 *   * ready       — the key is here; values open on Reveal.
 *
 * A concealed value renders a fixed run of dots, not the value under a mask —
 * a mask leaves the characters in the DOM for anything that reads the page.
 */
export default function VaultPage() {
  return (
    <VaultShell>
      <LockGate>
        <VaultBody />
      </LockGate>
    </VaultShell>
  );
}

function VaultShell({ children }: { children: React.ReactNode }) {
  const { vaultId } = useParams<{ vaultId: string }>();
  const vaultName = useVaultName(vaultId ?? null);
  return (
    <div className={shell.root}>
      <AppHeader back={{ label: 'Teams', to: '/teams' }} crumb={vaultName} />
      <main className={shell.mainWide}>{children}</main>
    </div>
  );
}

function VaultBody() {
  const { vaultId } = useParams<{ vaultId: string }>();
  const contextId = vaultId ?? null;
  const { mero } = useMero();
  const { appId } = useApplicationId();
  const client = useVaultClient(contextId);
  const vaultName = useVaultName(contextId);

  const [found, setFound] = useState<Found | null>(null);
  const team = useMemo(
    () =>
      found ? { namespaceId: found.namespaceId, vaultId: found.vaultId } : null,
    [found],
  );
  const {
    session,
    state,
    secrets,
    error: sessionError,
    approvals,
    awaitingApproval,
    holders,
    reload,
  } = useVaultSession(contextId, team);

  const [tab, setTab] = useState<Tab>('secrets');
  const [events, setEvents] = useState<AuditView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [tag, setTag] = useState('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [history, setHistory] = useState<{
    id: string;
    rows: Revision[];
  } | null>(null);
  const [editing, setEditing] = useState<Secret | null>(null);
  const [adding, setAdding] = useState(false);
  const [sharing, setSharing] = useState<Secret | null>(null);
  const [minting, setMinting] = useState(false);
  const [invite, setInvite] = useState<{
    code: string;
    scope: string;
    hint: string;
  } | null>(null);

  useEffect(() => {
    if (!mero || !appId || !contextId) return;
    let cancelled = false;
    findVaultByContext(mero.admin, appId, contextId)
      .then((f) => !cancelled && setFound(f))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [mero, appId, contextId]);

  const loadActivity = useCallback(async () => {
    if (!client) return;
    setEvents(await client.getAuditLogs().catch(() => []));
  }, [client]);

  useEffect(() => {
    if (tab === 'activity') void loadActivity();
  }, [tab, loadActivity, secrets]);

  // Hide everything that was revealed whenever the list changes under us.
  useEffect(() => setRevealed(new Set()), [state]);

  const live = useMemo(() => secrets.filter((s) => !s.trashed), [secrets]);
  const trashed = useMemo(() => secrets.filter((s) => s.trashed), [secrets]);
  const tags = useMemo(
    () => Array.from(new Set(live.flatMap((s) => s.tags))).sort(),
    [live],
  );

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return live
      .filter((s) => {
        const hit =
          !q ||
          s.name.toLowerCase().includes(q) ||
          s.tags.some((t) => t.toLowerCase().includes(q)) ||
          (s.fields.url ?? '').toLowerCase().includes(q) ||
          (s.fields.username ?? '').toLowerCase().includes(q);
        return hit && (tag === 'all' || s.tags.includes(tag));
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [live, query, tag]);

  const run = useCallback(
    async (fn: () => Promise<unknown>) => {
      setError(null);
      try {
        await fn();
        await reload();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [reload],
  );

  const toggleReveal = (id: string) =>
    setRevealed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const copy = async (value: string) => {
    try {
      await copySecret(value);
      setError(null);
    } catch {
      setError('Could not reach the clipboard — reveal the value and copy it.');
    }
  };

  const showHistory = async (s: Secret) => {
    if (!session) return;
    if (history?.id === s.id) return setHistory(null);
    setHistory({ id: s.id, rows: await session.history(s.id) });
  };

  const restore = (s: Secret, r: Revision) =>
    run(async () => {
      if (!session) return;
      const after = {
        kind: s.kind,
        name: s.name,
        tags: s.tags,
        fields: { ...s.fields },
      };
      if (r.field === 'name') after.name = r.previous;
      else if (r.field === 'tags')
        after.tags = JSON.parse(r.previous || '[]') as string[];
      else after.fields[r.field] = r.previous;
      await session.update(s, after);
      setHistory(null);
    });

  const inviteMember = async () => {
    if (!mero || !found) return;
    setError(null);
    setMinting(true);
    try {
      const restricted =
        String(
          (await mero.admin.getSubgroupVisibility(found.vaultId)) ?? '',
        ).toLowerCase() === 'restricted';
      const code = await mintVaultInvite(mero.admin, {
        namespaceId: found.namespaceId,
        vaultId: found.vaultId,
        vaultName: found.vaultName,
        teamName: found.teamName,
        contextId,
        restricted,
      });
      setInvite({
        code,
        scope: `Opens ${found.vaultName}`,
        hint: restricted
          ? `This vault is invite-only: the link admits them to “${found.vaultName}” and makes them a member of ${found.teamName}, but no other invite-only vault there. It expires in 24 hours.`
          : `This link lands them in “${found.vaultName}”, but the access it grants is the whole of ${found.teamName} — every open vault in the team, including ones added later. It expires in 24 hours.`,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setMinting(false);
    }
  };

  const role = session?.info?.my_role;
  const me = session?.info?.my_account;
  const canWrite = !!session?.canWrite;
  const personal = found?.personal;

  const tabs: [Tab, string][] = [
    ['secrets', `Secrets (${live.length})`],
    ['trash', `Trash (${trashed.length})`],
    ['health', 'Health'],
    ...(personal ? [] : ([['people', 'People & devices']] as [Tab, string][])),
    ['activity', 'Activity'],
    ['transfer', 'Import & export'],
  ];

  const renderSecret = (secret: Secret) => {
    const open = openId === secret.id;
    return (
      <div key={secret.id} className={styles.secret} data-testid="secret-row">
        <button
          type="button"
          className={styles.secretHead}
          onClick={() => {
            setOpenId(open ? null : secret.id);
            setHistory(null);
          }}
          aria-expanded={open}
        >
          <span className={styles.secretKind} aria-hidden="true">
            <KindIcon kind={secret.kind} />
          </span>
          <span>
            <span className={styles.secretName}>{secret.name}</span>
            <span className={styles.secretMeta}>
              {secret.kind.replace('_', ' ')} ·{' '}
              {asDate(secret.updatedAt).toLocaleDateString()} · by{' '}
              {short(secret.updatedBy, me)}
              {secret.unreadable ? ' · not readable on this device' : ''}
            </span>
          </span>
          <span className={styles.tags}>
            {secret.tags.map((t) => (
              <span key={t} className={shell.badge}>
                {t}
              </span>
            ))}
            <span className={styles.chevron}>{open ? '−' : '+'}</span>
          </span>
        </button>

        {open && (
          <div className={styles.secretBody}>
            {Object.entries(secret.fields).map(([key, text]) => {
              const id = `${secret.id}:${key}`;
              const hide = isSensitive(secret.kind, key);
              const show = !hide || revealed.has(id);
              return (
                <div key={key} className={styles.field}>
                  <span className={styles.fieldName}>
                    {key.replace(/_/g, ' ')}
                  </span>
                  {isTotpField(secret.kind, key) ? (
                    <TotpCode seed={text} />
                  ) : (
                    <span
                      className={`${styles.fieldValue} ${show ? '' : styles.fieldMasked}`}
                      data-testid={show ? 'field-shown' : 'field-hidden'}
                    >
                      {show ? text || '—' : '••••••••••••'}
                    </span>
                  )}
                  <span className={styles.fieldActions}>
                    {hide && !isTotpField(secret.kind, key) && (
                      <button
                        type="button"
                        className={styles.mini}
                        onClick={() => toggleReveal(id)}
                        data-testid="reveal"
                      >
                        {show ? 'Hide' : 'Reveal'}
                      </button>
                    )}
                    {!isTotpField(secret.kind, key) && (
                      <button
                        type="button"
                        className={styles.mini}
                        onClick={() => void copy(text)}
                      >
                        Copy
                      </button>
                    )}
                    {key === 'url' && /^https?:\/\//i.test(text) && (
                      <a
                        className={styles.mini}
                        href={text}
                        target="_blank"
                        rel="noreferrer noopener"
                      >
                        Open
                      </a>
                    )}
                  </span>
                </div>
              );
            })}

            {history?.id === secret.id && (
              <div className={styles.history} data-testid="secret-history">
                {history.rows.length === 0 ? (
                  <span className={styles.secretFooterNote}>
                    No earlier values.
                  </span>
                ) : (
                  history.rows.map((r, i) => (
                    <div key={i} className={styles.historyRow}>
                      <span className={styles.historyMeta}>
                        {asDate(r.replacedAt).toLocaleString()} ·{' '}
                        {short(r.replacedBy, me)}
                      </span>
                      <span>{r.field.replace(/_/g, ' ')}</span>
                      <span className={styles.fieldValue}>
                        {r.unreadable
                          ? 'sealed under a key this device never had'
                          : isSensitive(secret.kind, r.field)
                            ? '••••••••'
                            : r.previous}
                      </span>
                      {!r.unreadable && canWrite && (
                        <button
                          type="button"
                          className={styles.mini}
                          onClick={() => void restore(secret, r)}
                        >
                          Restore
                        </button>
                      )}
                    </div>
                  ))
                )}
              </div>
            )}

            <div className={styles.secretFooter}>
              <span className={styles.secretFooterNote}>
                Added {asDate(secret.createdAt).toLocaleString()} by{' '}
                {short(secret.createdBy, me)}
              </span>
              <button
                type="button"
                className={styles.mini}
                onClick={() => void showHistory(secret)}
              >
                History
              </button>
              {!secret.unreadable && (
                <button
                  type="button"
                  className={styles.mini}
                  onClick={() => setSharing(secret)}
                  data-testid="secret-share"
                >
                  Share
                </button>
              )}
              {canWrite && !secret.unreadable && (
                <button
                  type="button"
                  className={styles.mini}
                  onClick={() => setEditing(secret)}
                  data-testid="secret-edit"
                >
                  Edit
                </button>
              )}
              {canWrite && (
                <button
                  type="button"
                  className={styles.mini}
                  onClick={() =>
                    void run(() => client!.trashSecret({ id: secret.id }))
                  }
                  data-testid="secret-trash"
                >
                  Move to trash
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      <div className={shell.titleRow}>
        <div>
          <p className={shell.eyebrow}>
            {personal === true ? 'Private vault' : 'Vault'}
          </p>
          <h1 className={shell.title} data-testid="vault-heading">
            {vaultName}
          </h1>
          <p className={shell.subtitle} data-testid="vault-scope">
            {personal === true
              ? 'Private. Only your own devices can open this vault.'
              : personal === false
                ? `End-to-end encrypted · you are ${role === 'admin' ? 'an Admin' : role === 'editor' ? 'an Editor' : role === 'viewer' ? 'a Viewer' : 'not yet admitted'}`
                : ' '}
          </p>
        </div>
        <div className={shell.titleRowActions}>
          {personal === false && (
            <button
              type="button"
              className={shell.btnGhost}
              onClick={() => void inviteMember()}
              disabled={minting || !found}
              data-testid="vault-invite"
            >
              {minting ? 'Minting…' : 'Invite'}
            </button>
          )}
          <button
            type="button"
            className={shell.btn}
            onClick={() => setAdding(true)}
            disabled={!canWrite}
            data-testid="secret-add"
          >
            New secret
          </button>
        </div>
      </div>

      {(error || sessionError) && (
        <p className={shell.error} data-testid="error">
          {error ?? sessionError}
        </p>
      )}

      {state === 'no-identity' && (
        <p className={shell.empty} data-testid="no-identity">
          This node does not hold an identity in this vault yet. Open it from
          its team to join.
        </p>
      )}
      {state === 'loading' && <p className={shell.empty}>Opening the vault…</p>}
      {state === 'waiting' && awaitingApproval && (
        <div className={styles.banner} data-testid="waiting-for-approval">
          This browser needs approval. Open this vault on another device of
          yours that already reads it, or ask a vault Admin, and approve the
          request showing code{' '}
          <strong className={shell.mono} data-testid="my-approval-code">
            {deviceKeeper.fingerprint
              ? confirmationCode(deviceKeeper.fingerprint)
              : ''}
          </strong>
          . No other device left? Restore with your recovery key on the{' '}
          <Link to="/security">Security page</Link>.
        </div>
      )}
      {state === 'waiting' && !awaitingApproval && (
        <div className={styles.banner} data-testid="waiting-for-key">
          This device is registered but has not been given the vault key yet. It
          arrives as soon as a member who holds it opens the vault — nothing to
          do here, this page checks every few seconds.
        </div>
      )}
      {session && state === 'ready' && (
        <DeviceApprovals
          session={session}
          requests={approvals}
          me={session.info?.my_account}
          onChanged={() => void reload()}
        />
      )}
      {holders && holders.browsers <= 1 && holders.recovery === 0 && (
        <div className={styles.banner} data-testid="single-holder">
          <strong>Only this browser holds this vault's key.</strong> If you lose
          it, nobody can open the vault again. Create a recovery key on the{' '}
          <Link to="/security">Security page</Link>, open the vault from a
          second device, or download an encrypted backup.
        </div>
      )}
      {state === 'uninitialised' && (
        <div className={styles.banner}>
          This vault has no key yet. It is created the first time its Admin
          opens it.
        </div>
      )}
      {session && state === 'ready' && role === 'viewer' && (
        <div className={styles.banner}>
          You can read this vault but not change it.
        </div>
      )}

      {session && (state === 'ready' || state === 'waiting') && (
        <>
          <div className={shell.tabs} role="tablist">
            {tabs.map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                className={`${shell.tab} ${tab === id ? shell.tabActive : ''}`}
                onClick={() => setTab(id)}
                data-testid={`tab-${id}`}
              >
                {label}
              </button>
            ))}
          </div>

          {tab === 'secrets' && (
            <>
              <div className={styles.filters}>
                <input
                  className={shell.input}
                  placeholder="Search names, tags, usernames, sites…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  data-testid="secret-search"
                />
                <select
                  className={styles.select}
                  value={tag}
                  onChange={(e) => setTag(e.target.value)}
                  aria-label="Filter by tag"
                >
                  <option value="all">All tags</option>
                  {tags.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
              {shown.length === 0 ? (
                <p className={shell.empty} data-testid="secrets-empty">
                  {live.length === 0
                    ? 'No secrets yet. Everything you add is encrypted in this browser first.'
                    : 'Nothing matches that search.'}
                </p>
              ) : (
                <div data-testid="secret-list">{shown.map(renderSecret)}</div>
              )}
            </>
          )}

          {tab === 'trash' &&
            (trashed.length === 0 ? (
              <p className={shell.empty}>The trash is empty.</p>
            ) : (
              <div data-testid="trash-list">
                <p className={shell.sectionHint}>
                  Trashed secrets stay recoverable until an Admin deletes them
                  permanently.
                </p>
                {trashed.map((s) => (
                  <div key={s.id} className={shell.row}>
                    <div className={shell.rowMain}>
                      <div className={shell.rowName}>
                        <KindIcon kind={s.kind} size={14} /> {s.name}
                      </div>
                      <div className={shell.rowSub}>
                        Trashed {asDate(s.trashedAt).toLocaleString()}
                      </div>
                    </div>
                    <div className={shell.rowActions}>
                      {canWrite && (
                        <button
                          type="button"
                          className={shell.btnGhost}
                          onClick={() =>
                            void run(() => client!.restoreSecret({ id: s.id }))
                          }
                        >
                          Restore
                        </button>
                      )}
                      {role === 'admin' && (
                        <button
                          type="button"
                          className={shell.btnDanger}
                          onClick={() =>
                            void run(() => client!.purgeSecret({ id: s.id }))
                          }
                          data-testid="secret-purge"
                        >
                          Delete forever
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ))}

          {tab === 'health' && (
            <HealthPanel
              secrets={live}
              onOpen={(id) => {
                setTab('secrets');
                setOpenId(id);
              }}
            />
          )}

          {tab === 'people' && client && (
            <VaultPeople
              client={client}
              session={session}
              team={team}
              onChanged={() => void reload()}
            />
          )}

          {tab === 'activity' &&
            (events.length === 0 ? (
              <p className={shell.empty} data-testid="activity-empty">
                Nothing has happened in this vault yet.
              </p>
            ) : (
              <div data-testid="activity-list">
                {events.map((e, i) => (
                  <div key={i} className={styles.event}>
                    <span className={styles.eventDot} aria-hidden="true" />
                    <div>
                      <div className={styles.eventAction}>
                        {e.redacted
                          ? 'entry redacted by its author'
                          : e.action.replace(/[_:]/g, ' ')}
                      </div>
                      <div className={styles.eventDetail}>
                        {secrets.find((s) => s.id === e.target)?.name ??
                          e.target.slice(0, 24)}
                      </div>
                      <div className={styles.eventMeta}>
                        {asDate(e.timestamp).toLocaleString()} ·{' '}
                        {short(e.account, me)} · device {e.device.slice(0, 8)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ))}

          {tab === 'transfer' && (
            <ImportExport
              session={session}
              secrets={secrets}
              vaultName={vaultName}
              onDone={() => void reload()}
            />
          )}
        </>
      )}

      {session && (adding || editing) && (
        <SecretForm
          session={session}
          secret={editing ?? undefined}
          open
          onClose={() => {
            setAdding(false);
            setEditing(null);
          }}
          onSuccess={() => {
            setAdding(false);
            setEditing(null);
            void reload();
          }}
        />
      )}

      <ShareModal secret={sharing} onClose={() => setSharing(null)} />

      <InviteModal
        open={!!invite}
        code={invite?.code ?? ''}
        scope={invite?.scope ?? ''}
        hint={invite?.hint}
        onClose={() => setInvite(null)}
      />
    </>
  );
}
