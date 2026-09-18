import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from "react-router-dom";
import { useMero } from '@calimero-network/mero-react';

import AppHeader from '../../components/AppHeader';
import InviteModal from '../../components/InviteModal';
import SecretForm from '../../components/SecretForm';
import { useApplicationId } from '../../hooks/useApplicationId';
import type {
  AuditLogEntry,
  SecretItem,
} from '../../generated/MeroPassClient';
import { useVaultClient, useVaultName } from '../../lib/vault';
import { findVaultByContext, mintVaultInvite } from '../../lib/vaults';
import shell from '../../styles/shell.module.css';
import styles from './vault.module.css';

type Tab = 'secrets' | 'activity';

const KIND_MARK: Record<string, string> = {
  login: '🔑',
  secure_note: '📝',
  totp: '⏱',
  ssh_key: '🔐',
  payment_card: '💳',
};

/** Calimero stamps in nanoseconds; anything that large is not milliseconds. */
function asDate(stamp: number): Date {
  return new Date(stamp > 1e12 ? Math.floor(stamp / 1e6) : stamp);
}

/** Fields whose value is concealed until the viewer asks for it. */
const SENSITIVE = /pass|secret|key|cvv|token|seed|private/i;

function parseData(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object'
      ? (parsed as Record<string, unknown>)
      : { value: raw };
  } catch {
    return { value: raw };
  }
}

/**
 * One vault: its secrets, and what has happened to them.
 *
 * ── What changed beyond the paint ────────────────────────────────────────────
 *
 * A secret's value is CONCEALED until the viewer presses Reveal, per field, and
 * a concealed field renders a fixed run of dots rather than the value under a
 * CSS mask — a mask leaves the characters in the DOM, in the accessibility
 * tree, and on anything that copies the page. The old screen put every field
 * into a disabled `<Input value={…}>` the moment a modal opened.
 *
 * Rows expand in place instead of opening a modal, so the list stays put and
 * two secrets can be compared without closing one to see the other.
 */
export default function VaultPage() {
  const { vaultId } = useParams<{ vaultId: string }>();
  const { mero } = useMero();
  const { appId } = useApplicationId();
  const client = useVaultClient(vaultId ?? null);
  const vaultName = useVaultName(vaultId ?? null);

  const [tab, setTab] = useState<Tab>('secrets');
  const [secrets, setSecrets] = useState<SecretItem[]>([]);
  const [events, setEvents] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [tag, setTag] = useState('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [editing, setEditing] = useState<SecretItem | null>(null);
  const [adding, setAdding] = useState(false);
  const [minting, setMinting] = useState(false);
  const [invite, setInvite] = useState<{
    code: string;
    scope: string;
    hint: string;
  } | null>(null);
  const [teamId, setTeamId] = useState<string | null>(null);

  const load = useCallback(async () => {
    // ⚠️ `return` alone leaves `loading` true FOREVER. A null client is not a
    // transient state — it is what this node has when it is in the team but
    // holds no identity in this vault's context yet, which is the normal state
    // right after joining. The page used to sit on "Loading…" indefinitely
    // instead of saying so; the screenshot harness is what caught it, because
    // the scenario for that state timed out waiting for its own landmark.
    if (!client) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [s, a] = await Promise.all([
        client.listSecrets(),
        client.getAuditLogs(),
      ]);
      setSecrets(s);
      setEvents(a);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load this vault');
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  // Which team this vault belongs to, for the back link. A context knows
  // nothing about its parents, so this is a scan — done once, in the
  // background, and the header falls back to "Teams" until it lands.
  useEffect(() => {
    if (!mero || !appId || !vaultId) return;
    let cancelled = false;
    findVaultByContext(mero.admin, appId, vaultId)
      .then((found) => {
        if (!cancelled) setTeamId(found?.namespaceId ?? null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [mero, appId, vaultId]);

  const tags = useMemo(
    () => Array.from(new Set(secrets.flatMap((s) => s.tags))).sort(),
    [secrets],
  );

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return secrets.filter((s) => {
      const matchesQuery =
        !q ||
        s.name.toLowerCase().includes(q) ||
        s.tags.some((t) => t.toLowerCase().includes(q));
      return matchesQuery && (tag === 'all' || s.tags.includes(tag));
    });
  }, [secrets, query, tag]);

  const toggleReveal = useCallback((id: string) => {
    setRevealed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const copy = useCallback(async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      setError('Could not reach the clipboard — reveal the value and copy it.');
    }
  }, []);

  const removeSecret = useCallback(
    async (secret: SecretItem) => {
      if (!client) return;
      setDeleting(secret.id);
      setError(null);
      try {
        await client.deleteSecret({ secret_id: secret.id });
        setConfirmDelete(null);
        await load();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to delete');
      } finally {
        setDeleting(null);
      }
    },
    [client, load],
  );

  const inviteMember = useCallback(async () => {
    if (!mero || !appId || !vaultId) return;
    setError(null);
    setMinting(true);
    try {
      const found = await findVaultByContext(mero.admin, appId, vaultId);
      if (!found) {
        setError(
          'This node cannot tell which team this vault belongs to, so it cannot mint an invitation. Open the team and invite from there.',
        );
        return;
      }
      const code = await mintVaultInvite(mero.admin, {
        namespaceId: found.namespaceId,
        vaultId: found.vaultId,
        vaultName: found.vaultName,
        teamName: found.teamName,
        contextId: vaultId,
      });
      setInvite({
        code,
        scope: `Opens ${found.vaultName}`,
        hint: `This link lands them in “${found.vaultName}”, but the access it grants is the whole of ${found.teamName} — every vault in the team, including ones added later.`,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setMinting(false);
    }
  }, [mero, appId, vaultId]);

  return (
    <div className={shell.root}>
      <AppHeader
        back={{ label: 'Teams', to: teamId ? `/teams/${teamId}` : '/teams' }}
        crumb={vaultName}
      />

      <main className={shell.mainWide}>
        <div className={shell.titleRow}>
          <div>
            <h1 className={shell.title} data-testid="vault-heading">
              {vaultName}
            </h1>
            <p className={shell.subtitle}>
              Shared with everyone in this vault&rsquo;s team.
            </p>
          </div>
          <div className={shell.titleRowActions}>
            <button
              type="button"
              className={shell.btnGhost}
              onClick={() => void inviteMember()}
              disabled={minting || !mero || !appId}
              data-testid="vault-invite"
            >
              {minting ? 'Minting…' : 'Invite'}
            </button>
            <button
              type="button"
              className={shell.btn}
              onClick={() => setAdding(true)}
              disabled={!client}
              data-testid="secret-add"
            >
              New secret
            </button>
          </div>
        </div>

        <div className={styles.stats}>
          <div className={styles.stat}>
            <span className={styles.statValue}>{secrets.length}</span>
            <span className={styles.statLabel}>Secrets</span>
          </div>
          <div className={styles.stat}>
            <span className={styles.statValue}>{tags.length}</span>
            <span className={styles.statLabel}>Tags</span>
          </div>
          <div className={styles.stat}>
            <span className={styles.statValue}>{events.length}</span>
            <span className={styles.statLabel}>Events</span>
          </div>
        </div>

        <div className={shell.tabs} role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'secrets'}
            className={`${shell.tab} ${tab === 'secrets' ? shell.tabActive : ''}`}
            onClick={() => setTab('secrets')}
            data-testid="tab-secrets"
          >
            Secrets
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'activity'}
            className={`${shell.tab} ${tab === 'activity' ? shell.tabActive : ''}`}
            onClick={() => setTab('activity')}
            data-testid="tab-activity"
          >
            Activity
          </button>
        </div>

        {error && (
          <p className={shell.error} data-testid="error">
            {error}
          </p>
        )}

        {tab === 'secrets' ? (
          <>
            <div className={styles.filters}>
              <input
                className={shell.input}
                placeholder="Search by name or tag…"
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

            {loading ? (
              <p className={shell.empty}>Loading…</p>
            ) : !client ? (
              <p className={shell.empty} data-testid="no-identity">
                This node does not hold an identity in this vault yet. Open it
                from its team to join.
              </p>
            ) : shown.length === 0 ? (
              <p className={shell.empty} data-testid="secrets-empty">
                {secrets.length === 0
                  ? 'No secrets yet. Add the first one above — everyone in the team will have it.'
                  : 'Nothing matches that search.'}
              </p>
            ) : (
              <div data-testid="secret-list">
                {shown.map((secret) => {
                  const open = openId === secret.id;
                  const fields = Object.entries(parseData(secret.data));
                  return (
                    <div
                      key={secret.id}
                      className={styles.secret}
                      data-testid="secret-row"
                    >
                      <button
                        type="button"
                        className={styles.secretHead}
                        onClick={() => setOpenId(open ? null : secret.id)}
                        aria-expanded={open}
                      >
                        <span className={styles.secretKind} aria-hidden="true">
                          {KIND_MARK[secret.secret_type] ?? '🔒'}
                        </span>
                        <span>
                          <span className={styles.secretName}>
                            {secret.name}
                          </span>
                          <span className={styles.secretMeta}>
                            {secret.secret_type.replace('_', ' ')} · v
                            {secret.version} ·{' '}
                            {asDate(secret.updated_at).toLocaleDateString()}
                          </span>
                        </span>
                        <span className={styles.tags}>
                          {secret.tags.map((t) => (
                            <span key={t} className={shell.badge}>
                              {t}
                            </span>
                          ))}
                          <span className={styles.chevron}>
                            {open ? '▲' : '▼'}
                          </span>
                        </span>
                      </button>

                      {open && (
                        <div className={styles.secretBody}>
                          {fields.map(([key, value]) => {
                            const id = `${secret.id}:${key}`;
                            const text = String(value ?? '');
                            const hide = SENSITIVE.test(key);
                            const show = !hide || revealed.has(id);
                            return (
                              <div key={key} className={styles.field}>
                                <span className={styles.fieldName}>
                                  {key.replace(/_/g, ' ')}
                                </span>
                                <span
                                  className={`${styles.fieldValue} ${show ? '' : styles.fieldMasked}`}
                                  data-testid={
                                    show ? 'field-shown' : 'field-hidden'
                                  }
                                >
                                  {/* A fixed run of dots, not the value under a
                                      mask: a mask leaves the characters in the
                                      DOM for anything that reads the page. */}
                                  {show ? text || '—' : '••••••••••••'}
                                </span>
                                <span className={styles.fieldActions}>
                                  {hide && (
                                    <button
                                      type="button"
                                      className={styles.mini}
                                      onClick={() => toggleReveal(id)}
                                      data-testid="reveal"
                                    >
                                      {show ? 'Hide' : 'Reveal'}
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    className={styles.mini}
                                    onClick={() => void copy(text)}
                                  >
                                    Copy
                                  </button>
                                </span>
                              </div>
                            );
                          })}

                          <div className={styles.secretFooter}>
                            <span className={styles.secretFooterNote}>
                              Added {asDate(secret.created_at).toLocaleString()}
                            </span>
                            <button
                              type="button"
                              className={styles.mini}
                              onClick={() => setEditing(secret)}
                              data-testid="secret-edit"
                            >
                              Edit
                            </button>
                            {confirmDelete === secret.id ? (
                              <>
                                <button
                                  type="button"
                                  className={shell.btnDanger}
                                  onClick={() => void removeSecret(secret)}
                                  disabled={deleting === secret.id}
                                  data-testid="secret-delete-confirm"
                                >
                                  {deleting === secret.id
                                    ? 'Deleting…'
                                    : 'Delete for everyone'}
                                </button>
                                <button
                                  type="button"
                                  className={styles.mini}
                                  onClick={() => setConfirmDelete(null)}
                                >
                                  Cancel
                                </button>
                              </>
                            ) : (
                              <button
                                type="button"
                                className={styles.mini}
                                onClick={() => setConfirmDelete(secret.id)}
                                data-testid="secret-delete"
                              >
                                Delete
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        ) : loading ? (
          <p className={shell.empty}>Loading…</p>
        ) : events.length === 0 ? (
          <p className={shell.empty} data-testid="activity-empty">
            Nothing has happened in this vault yet.
          </p>
        ) : (
          <div data-testid="activity-list">
            {events.map((e) => (
              <div key={e.id} className={styles.event}>
                <span className={styles.eventDot} aria-hidden="true" />
                <div>
                  <div className={styles.eventAction}>
                    {e.action.replace(/_/g, ' ')}
                  </div>
                  <div className={styles.eventDetail}>{e.details}</div>
                  <div className={styles.eventMeta}>
                    {asDate(e.timestamp).toLocaleString()} ·{' '}
                    {e.user_public_key.slice(0, 12)}…
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {client && (adding || editing) && (
        <SecretForm
          api={client}
          secret={editing ?? undefined}
          open
          onClose={() => {
            setAdding(false);
            setEditing(null);
          }}
          onSuccess={() => {
            setAdding(false);
            setEditing(null);
            void load();
          }}
        />
      )}

      <InviteModal
        open={!!invite}
        code={invite?.code ?? ''}
        scope={invite?.scope ?? ''}
        hint={invite?.hint}
        onClose={() => setInvite(null)}
      />
    </div>
  );
}
