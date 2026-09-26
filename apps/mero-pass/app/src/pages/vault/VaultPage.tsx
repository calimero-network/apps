import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMero } from '@calimero-network/mero-react';

import AppHeader from '../../components/AppHeader';
import DeviceApprovals from '../../components/DeviceApprovals';
import HealthPanel from '../../components/HealthPanel';
import ImportExport from '../../components/ImportExport';
import InviteModal from '../../components/InviteModal';
import LockGate from '../../components/LockGate';
import SecretForm from '../../components/SecretForm';
import ShareModal from '../../components/ShareModal';
import VaultPeople from '../../components/VaultPeople';
import { PlusIcon } from '../../components/icons';
import type { AuditView } from '../../generated/MeroPassClient';
import { useApplicationId } from '../../hooks/useApplicationId';
import { useVaultSession } from '../../hooks/useVaultSession';
import { CLIPBOARD_CLEAR_MS, copySecret } from '../../lib/clipboard';
import { deviceKeeper } from '../../lib/deviceKey';
import { describeError } from '../../lib/errors';
import { analyse } from '../../lib/health';
import { CATEGORIES, asDate, byName, matches, who } from '../../lib/itemView';
import type { Kind } from '../../lib/secretKinds';
import { useVaultClient, useVaultName } from '../../lib/vault';
import {
  type Revision,
  type Secret,
  confirmationCode,
} from '../../lib/vaultSession';
import { findVaultByContext, mintVaultInvite } from '../../lib/vaults';
import shell from '../../styles/shell.module.css';
import ItemDetail from './ItemDetail';
import ItemList, { KindIcon, SearchBox } from './ItemList';
import VaultSidebar, { type View } from './VaultSidebar';
import styles from './items.module.css';
import vault from './vault.module.css';

interface Found {
  namespaceId: string;
  vaultId: string;
  vaultName: string;
  teamName: string;
  personal: boolean;
}

const ROLE_TEXT: Record<string, string> = {
  admin: 'you are an Admin',
  editor: 'you are an Editor',
  viewer: 'you can view',
  pending: 'waiting for an Admin to let you in',
  removed: 'you were removed from this vault',
};

/**
 * One vault, laid out as a password manager is: categories and tags on the
 * left, the matching items in the middle, the picked item on the right.
 *
 * ── What the page can and cannot see ─────────────────────────────────────────
 *
 * Every secret arrives from the node as ciphertext and is opened here with the
 * vault key, which this device receives wrapped to its own public key (see
 * `lib/vaultSession`). So before a list there are these honest states:
 *
 *   * locked   — the device key is not in memory. Nothing renders.
 *   * loading  — opening; while the node is still joining or syncing the
 *                vault this retries, and the strip says what it waits for.
 *   * failed   — a refusal that will not clear by itself, with Retry.
 *   * waiting  — registered, but nobody holding the key has wrapped it to us.
 *                We see THAT items exist, not what they are. When the account
 *                already has a browser that holds the key, this one waits for
 *                that browser (or an admin) to approve it, and shows the code.
 *   * ready    — the key is here; values open on Reveal.
 */
export default function VaultPage() {
  const { vaultId } = useParams<{ vaultId: string }>();
  const vaultName = useVaultName(vaultId ?? null);
  return (
    <div className={shell.root}>
      <AppHeader back={{ label: 'Teams', to: '/teams' }} crumb={vaultName} />
      <LockGate>
        <VaultBody />
      </LockGate>
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
    notice,
    approvals,
    awaitingApproval,
    holders,
    reload,
    retry,
  } = useVaultSession(contextId, team);

  const [view, setView] = useState<View>({ type: 'all' });
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [events, setEvents] = useState<AuditView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [editing, setEditing] = useState<Secret | null>(null);
  const [adding, setAdding] = useState<Kind | null>(null);
  const [sharing, setSharing] = useState<Secret | null>(null);
  const [minting, setMinting] = useState(false);
  const [invite, setInvite] = useState<{
    code: string;
    scope: string;
    hint: string;
  } | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

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

  const tool = view.type === 'tool' ? view.tool : null;

  useEffect(() => {
    if (tool !== 'activity' || !client) return;
    void client
      .getAuditLogs()
      .then(setEvents)
      .catch(() => setEvents([]));
  }, [tool, client, secrets]);

  // `/` jumps to search from anywhere that is not already a text field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(t.tagName)))
        return;
      e.preventDefault();
      if (view.type === 'tool') setView({ type: 'all' });
      requestAnimationFrame(() => searchRef.current?.focus());
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [view]);

  const live = useMemo(() => secrets.filter((s) => !s.trashed), [secrets]);
  const trashed = useMemo(() => secrets.filter((s) => s.trashed), [secrets]);
  const tags = useMemo(
    () => Array.from(new Set(live.flatMap((s) => s.tags))).sort(),
    [live],
  );
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: live.length };
    for (const s of live) c[s.kind] = (c[s.kind] ?? 0) + 1;
    return c;
  }, [live]);
  const flagged = useMemo(
    () => analyse(live).filter((r) => r.issues.length > 0).length,
    [live],
  );

  const shown = useMemo(
    () =>
      live
        .filter((s) =>
          view.type === 'kind'
            ? s.kind === view.kind
            : view.type === 'tag'
              ? s.tags.includes(view.tag)
              : true,
        )
        .filter((s) => matches(s, query))
        .sort(byName),
    [live, view, query],
  );

  const current = shown.find((s) => s.id === selected) ?? null;

  // Keep something picked on a wide screen, as the list changes under us.
  useEffect(() => {
    if (selected && !live.some((s) => s.id === selected)) setSelected(null);
  }, [live, selected]);

  const run = useCallback(
    async (fn: () => Promise<unknown>) => {
      setError(null);
      try {
        await fn();
        await reload();
      } catch (e) {
        setError(describeError(e));
      }
    },
    [reload],
  );

  const copy = async (value: string, what: string) => {
    try {
      await copySecret(value);
      setToast(`${what} copied — clears in ${CLIPBOARD_CLEAR_MS / 1000}s`);
    } catch {
      setToast('Could not reach the clipboard — reveal the value and copy it.');
    }
  };
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2_500);
    return () => clearTimeout(t);
  }, [toast]);

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
      setError(describeError(e));
    } finally {
      setMinting(false);
    }
  };

  const role = session?.info?.my_role;
  const me = session?.info?.my_account;
  const canWrite = !!session?.canWrite;
  const personal = found?.personal === true;
  const readable = !!session && (state === 'ready' || state === 'waiting');
  const newKind: Kind = view.type === 'kind' ? (view.kind as Kind) : 'login';

  const heading =
    view.type === 'kind'
      ? (CATEGORIES.find((c) => c.id === view.kind)?.label ?? 'Items')
      : view.type === 'tag'
        ? `Tagged “${view.tag}”`
        : 'All items';

  const subtitle = personal
    ? 'Private · only your own devices can open it'
    : role
      ? `End-to-end encrypted · ${ROLE_TEXT[role] ?? role}`
      : 'End-to-end encrypted';

  const shownError = error ?? sessionError;

  return (
    <main className={styles.main}>
      <div className={styles.bar}>
        <div className={styles.barTitle}>
          <h1 className={styles.barName} data-testid="vault-heading">
            {vaultName}
          </h1>
          <p className={styles.barSub} data-testid="vault-scope">
            {subtitle}
          </p>
        </div>
        <div className={styles.barActions}>
          {found && !personal && (
            <button
              type="button"
              className={shell.btnGhost}
              onClick={() => void inviteMember()}
              disabled={minting}
              data-testid="vault-invite"
            >
              {minting ? 'Minting…' : 'Invite'}
            </button>
          )}
          <button
            type="button"
            className={shell.btn}
            onClick={() => setAdding(newKind)}
            disabled={!canWrite}
            data-testid="secret-add"
          >
            <PlusIcon size={14} /> New item
          </button>
        </div>
      </div>

      {shownError && (
        <div
          className={`${styles.strip} ${styles.stripError}`}
          data-testid="error"
        >
          <span className={styles.stripText}>{shownError}</span>
          {state === 'failed' && (
            <button type="button" className={shell.btnGhost} onClick={retry}>
              Try again
            </button>
          )}
        </div>
      )}
      {state === 'loading' && (
        <div className={styles.strip} data-testid="opening">
          <span className={styles.stripText}>
            {notice ? (
              <>
                <strong>{notice}</strong> Trying again on its own.
              </>
            ) : (
              'Opening the vault…'
            )}
          </span>
        </div>
      )}
      {state === 'no-identity' && (
        <div
          className={`${styles.strip} ${styles.stripWarn}`}
          data-testid="no-identity"
        >
          <span className={styles.stripText}>
            This node does not hold an identity in this vault yet. Open it from
            its <Link to="/teams">team</Link> to join.
          </span>
        </div>
      )}
      {state === 'waiting' && role === 'pending' && (
        <div
          className={`${styles.strip} ${styles.stripWarn}`}
          data-testid="waiting-for-admission"
        >
          <span className={styles.stripText}>
            <strong>You are in, but not admitted yet.</strong> A vault Admin
            lets you in the next time they open this vault. This page updates by
            itself.
          </span>
        </div>
      )}
      {state === 'waiting' && role !== 'pending' && awaitingApproval && (
        <div
          className={`${styles.strip} ${styles.stripWarn}`}
          data-testid="waiting-for-approval"
        >
          <span className={styles.stripText}>
            <strong>Approve this browser.</strong> On another device of yours
            that opens this vault, or from a vault Admin, approve the request
            showing{' '}
            <span className={styles.code} data-testid="my-approval-code">
              {deviceKeeper.fingerprint
                ? confirmationCode(deviceKeeper.fingerprint)
                : ''}
            </span>
            . Lost every other device? Use your{' '}
            <Link to="/security">recovery key</Link>.
          </span>
        </div>
      )}
      {state === 'waiting' && role !== 'pending' && !awaitingApproval && (
        <div
          className={`${styles.strip} ${styles.stripWarn}`}
          data-testid="waiting-for-key"
        >
          <span className={styles.stripText}>
            <strong>Waiting for the vault key.</strong> It arrives as soon as a
            member who holds it opens the vault. Nothing to do here.
          </span>
        </div>
      )}
      {state === 'uninitialised' && (
        <div className={`${styles.strip} ${styles.stripWarn}`}>
          <span className={styles.stripText}>
            This vault has no key yet. It is created the first time its Admin
            opens it.
          </span>
        </div>
      )}
      {holders && holders.browsers <= 1 && holders.recovery === 0 && (
        <div
          className={`${styles.strip} ${styles.stripWarn}`}
          data-testid="single-holder"
        >
          <span className={styles.stripText}>
            <strong>Only this browser can open this vault.</strong> Lose it and
            the items are gone.{' '}
            <Link to="/security">Create a recovery key</Link> or open the vault
            on a second device.
          </span>
        </div>
      )}
      {session && state === 'ready' && approvals.length > 0 && (
        <div className={styles.strip}>
          <div className={styles.stripText}>
            <DeviceApprovals
              session={session}
              requests={approvals}
              me={session.info?.my_account}
              onChanged={() => void reload()}
            />
          </div>
        </div>
      )}

      {readable && (
        <div className={styles.panes} data-picked={current ? 'true' : 'false'}>
          <VaultSidebar
            view={view}
            onView={(v) => {
              setView(v);
              setSelected(null);
            }}
            counts={counts}
            tags={tags}
            trashed={trashed.length}
            flagged={flagged}
            personal={personal}
          />

          {tool ? (
            <section className={styles.wide}>
              {tool === 'health' && (
                <HealthPanel
                  secrets={live}
                  onOpen={(id) => {
                    setView({ type: 'all' });
                    setSelected(id);
                  }}
                />
              )}
              {tool === 'trash' && (
                <TrashList
                  items={trashed}
                  canWrite={canWrite}
                  canPurge={role === 'admin'}
                  onRestore={(s) =>
                    void run(() => client!.restoreSecret({ id: s.id }))
                  }
                  onPurge={(s) =>
                    void run(() => client!.purgeSecret({ id: s.id }))
                  }
                />
              )}
              {tool === 'people' && client && (
                <VaultPeople
                  client={client}
                  session={session}
                  team={team}
                  onChanged={() => void reload()}
                />
              )}
              {tool === 'activity' && (
                <ActivityList events={events} secrets={secrets} me={me} />
              )}
              {tool === 'transfer' && (
                <ImportExport
                  session={session}
                  secrets={secrets}
                  vaultName={vaultName}
                  onDone={() => void reload()}
                />
              )}
            </section>
          ) : (
            <>
              <section className={styles.list} aria-label="Items">
                <SearchBox
                  ref={searchRef}
                  value={query}
                  onChange={setQuery}
                  placeholder={`Search ${vaultName || 'this vault'}`}
                />
                <ItemList
                  heading={heading}
                  items={shown}
                  selected={current?.id ?? null}
                  onSelect={setSelected}
                  onCopy={(v, what) => void copy(v, what)}
                  empty={
                    query ? (
                      'Nothing matches that search.'
                    ) : state === 'waiting' ? (
                      'Items appear here once this device has the vault key.'
                    ) : live.length === 0 ? (
                      <>
                        This vault is empty.
                        <br />
                        {canWrite && (
                          <button
                            type="button"
                            className={shell.btn}
                            style={{ marginTop: '1rem' }}
                            onClick={() => setAdding('login')}
                          >
                            Add your first item
                          </button>
                        )}
                      </>
                    ) : (
                      'Nothing here yet.'
                    )
                  }
                />
              </section>
              <section className={styles.detailPane} aria-label="Item">
                {current ? (
                  <ItemDetail
                    secret={current}
                    me={me}
                    canWrite={canWrite}
                    onBack={() => setSelected(null)}
                    onCopy={(v, what) => void copy(v, what)}
                    onEdit={() => setEditing(current)}
                    onShare={() => setSharing(current)}
                    onTrash={() =>
                      void run(async () => {
                        await client!.trashSecret({ id: current.id });
                        setSelected(null);
                      })
                    }
                    loadHistory={() => session!.history(current.id)}
                    onRestore={(r) => void restore(current, r)}
                  />
                ) : (
                  <div className={styles.detailEmpty}>
                    {shown.length > 0
                      ? 'Pick an item to see it here.'
                      : state === 'ready'
                        ? 'Everything you add is encrypted in this browser before it leaves.'
                        : ''}
                  </div>
                )}
              </section>
            </>
          )}
        </div>
      )}

      {session && (adding || editing) && (
        <SecretForm
          session={session}
          secret={editing ?? undefined}
          initialKind={adding ?? undefined}
          open
          onClose={() => {
            setAdding(null);
            setEditing(null);
          }}
          onSuccess={(id) => {
            setAdding(null);
            setEditing(null);
            if (id) setSelected(id);
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

      {toast && (
        <div className={styles.toast} role="status" data-testid="toast">
          {toast}
        </div>
      )}
    </main>
  );
}

function TrashList({
  items,
  canWrite,
  canPurge,
  onRestore,
  onPurge,
}: {
  items: Secret[];
  canWrite: boolean;
  canPurge: boolean;
  onRestore: (s: Secret) => void;
  onPurge: (s: Secret) => void;
}) {
  if (items.length === 0)
    return <p className={shell.empty}>The trash is empty.</p>;
  return (
    <div data-testid="trash-list">
      <h2 className={shell.sectionLabel}>Trash</h2>
      <p className={shell.sectionHint}>
        Items stay recoverable here until an Admin deletes them for good.
      </p>
      {items.map((s) => (
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
                onClick={() => onRestore(s)}
              >
                Restore
              </button>
            )}
            {canPurge && (
              <button
                type="button"
                className={shell.btnDanger}
                onClick={() => onPurge(s)}
                data-testid="secret-purge"
              >
                Delete forever
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function ActivityList({
  events,
  secrets,
  me,
}: {
  events: AuditView[];
  secrets: Secret[];
  me?: string;
}) {
  if (events.length === 0)
    return (
      <p className={shell.empty} data-testid="activity-empty">
        Nothing has happened in this vault yet.
      </p>
    );
  return (
    <div data-testid="activity-list">
      <h2 className={shell.sectionLabel}>Activity</h2>
      {events.map((e, i) => (
        <div key={i} className={vault.event}>
          <span className={vault.eventDot} aria-hidden="true" />
          <div>
            <div className={vault.eventAction}>
              {e.redacted
                ? 'entry redacted by its author'
                : e.action.replace(/[_:]/g, ' ')}
            </div>
            <div className={vault.eventDetail}>
              {secrets.find((s) => s.id === e.target)?.name ??
                e.target.slice(0, 24)}
            </div>
            <div className={vault.eventMeta}>
              {asDate(e.timestamp).toLocaleString()} · {who(e.account, me)} ·
              device {e.device.slice(0, 8)}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
