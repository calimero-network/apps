import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  Copy,
  Layers,
  MoreHorizontal,
  Plus,
  Server,
  UserPlus,
} from 'lucide-react';

import { AppShell } from '../../components/shell/AppShell';
import {
  NOT_INSTALLED_MESSAGE,
  useApplicationId,
} from '../../hooks/useApplicationId';
import { setActiveWorkspace } from '../../lib/activeWorkspace';
import {
  createWorkspace,
  listWorkspaces,
  type WorkspaceRow,
} from '../../lib/agreements';
import { encodeInvite } from '../../lib/inviteCodec';
import { invitationUrl } from '../../lib/inviteLink';
import { hueOf, initials } from '../../lib/monogram';
import { adminApi, apiClient } from '../../lib/node';
import { useCalimero } from '../../lib/useCalimero';
import styles from './AgreementsPage.module.css';

// ── The workspace picker ─────────────────────────────────────────────────────
//
// ── Why this screen exists ──────────────────────────────────────────────────
//
// Not as a feature. Mero Sign was built on "one agreement is one context, and
// there are no namespaces", and at 0.11.0-rc.41 that model stopped being
// legal: `CreateContextRequest.group_id` has no `Option` and no
// `#[serde(default)]`, so a context must name a group. The app had nothing to
// put there and could not create an agreement at all.
//
// A namespace is therefore required. Given that, it is worth making it mean
// something rather than minting a hidden one per agreement — and the fleet
// already has the shape: mero-pass (team → vault), mero-forum (space → forum),
// mero-docs (workspace → folder).
//
//   WORKSPACE  — the people. You invite people HERE. This screen.
//   AGREEMENT  — one document set, inside a workspace. The next screen.
//   DOCUMENT   — the thing that gets signed, inside an agreement.
//
// ── What that changes about invitations ─────────────────────────────────────
//
// An invitation grants membership of the WORKSPACE, not of one agreement, and
// the agreement is reached by inheritance from there. That is what lets one
// link cover a working relationship instead of one PDF, and it is why the
// invite control lives on this screen rather than on an agreement's.

interface Banner {
  kind: 'notice' | 'error';
  text: string;
}

export default function WorkspacesPage() {
  const navigate = useNavigate();
  // Changes on every navigation, including one to the URL already showing —
  // which is what an accepted invitation that resolved to no single workspace
  // does. See the load effect.
  const { key: navigationKey } = useLocation();
  const { app } = useCalimero();
  const {
    applicationId,
    loading: idLoading,
    notInstalled,
  } = useApplicationId();

  const [rows, setRows] = useState<WorkspaceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [banner, setBanner] = useState<Banner | null>(null);

  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [status, setStatus] = useState('');

  const [inviteFor, setInviteFor] = useState<WorkspaceRow | null>(null);
  const [inviteLink, setInviteLink] = useState('');
  const [minting, setMinting] = useState(false);

  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    if (!applicationId) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      setRows(await listWorkspaces(adminApi(), applicationId));
      setBanner(null);
    } catch (error) {
      setRows([]);
      setBanner({
        kind: 'error',
        text:
          error instanceof Error
            ? error.message
            : 'Could not load your workspaces.',
      });
    } finally {
      setLoading(false);
    }
  }, [applicationId]);

  // Keyed on the navigation too: the invitation prompt lives above the routes
  // and lands the joiner by navigating, so a join that lands here has to
  // reload the list someone may already be looking at.
  useEffect(() => {
    if (app && !idLoading) void load();
  }, [app, idLoading, load, navigationKey]);

  useEffect(() => {
    function onOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpenId(null);
      }
    }
    document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, []);

  const open = useCallback(
    (row: WorkspaceRow) => {
      // Set BEFORE navigating. `useCalimero()` reads the active workspace to
      // build the `app` handle, and the agreements screen creates agreements
      // through it — arriving with the store still on the previous workspace
      // would put a new agreement in the wrong one.
      setActiveWorkspace(row.namespaceId);
      navigate(`/workspaces/${row.namespaceId}`);
    },
    [navigate],
  );

  const create = useCallback(async () => {
    const name = newName.trim();
    if (!name || !applicationId) return;
    setCreating(true);
    setBanner(null);
    try {
      // The creator's own account, so `createWorkspace` can give them the
      // admin mask explicitly. Without it the node reports the DEFAULT
      // capabilities for the creator — which were just set to the signer mask
      // — and the person who made the workspace cannot put an agreement in it.
      const identity = await apiClient.node().createNewIdentity();
      const created = await createWorkspace(
        adminApi(),
        { applicationId, name, accountId: identity.data?.accountId ?? null },
        setStatus,
      );
      setNewName('');
      setStatus('');
      setActiveWorkspace(created.namespaceId);
      if (created.haError) {
        // Founded, but the cloud is not hosting it — for an account that is
        // "this account is not linked to a cloud user yet". Said NOW, where
        // the person can act on it, rather than at invite time as a bare
        // "not hosted". Staying on this screen is what keeps the sentence
        // on the screen; the new workspace is in the list below it. The
        // banner is set AFTER the reload, which clears it on success.
        await load();
        setBanner({
          kind: 'notice',
          text:
            `"${name}" was created, but invitations to it will not work ` +
            `yet: ${created.haError}. Link this account to your cloud ` +
            'user in the wallet before inviting anyone.',
        });
        return;
      }
      navigate(`/workspaces/${created.namespaceId}`);
    } catch (error) {
      setStatus('');
      setBanner({
        kind: 'error',
        text:
          error instanceof Error
            ? error.message
            : 'Could not create that workspace.',
      });
    } finally {
      setCreating(false);
    }
  }, [applicationId, load, navigate, newName]);

  const invite = useCallback(async (row: WorkspaceRow) => {
    setInviteFor(row);
    setInviteLink('');
    setMinting(true);
    try {
      const res = await apiClient
        .node()
        .contextInviteByOpenInvitation(row.namespaceId);
      if (res.error || !res.data) {
        throw new Error(res.error?.message ?? 'The node minted no invitation.');
      }
      // `encodeInvite` unwraps the admin-api envelope itself; the workspace
      // name rides alongside so the recipient's prompt can say what they are
      // being invited to before they commit. It is outside the signature and
      // is treated as a display hint on the other side.
      const code = encodeInvite({
        invitation: res.data as never,
        workspaceName: row.name,
      });
      setInviteLink(invitationUrl(code));
    } catch (error) {
      setInviteFor(null);
      setBanner({
        kind: 'error',
        text:
          error instanceof Error
            ? error.message
            : 'Could not mint an invitation.',
      });
    } finally {
      setMinting(false);
    }
  }, []);

  const body = useMemo(() => {
    if (notInstalled) {
      return (
        <div className={styles.emptyState}>
          <span className={styles.emptyIcon}>
            <Server size={24} />
          </span>
          <p className={styles.empty} data-testid="not-installed">
            {NOT_INSTALLED_MESSAGE}
          </p>
        </div>
      );
    }
    if (loading || idLoading) {
      return (
        <div className={styles.skeletonGrid} aria-label="Loading…">
          <span className={styles.skeleton} />
          <span className={styles.skeleton} />
          <span className={styles.skeleton} />
        </div>
      );
    }
    if (banner?.kind === 'error') return null;
    if (rows.length === 0) {
      return (
        <div className={styles.emptyState}>
          <span className={styles.emptyIcon}>
            <Layers size={24} />
          </span>
          <p className={styles.emptyTitle}>No workspaces yet</p>
          <p className={styles.empty} data-testid="workspaces-empty">
            No workspaces yet. Create one above, or open an invitation link
            someone sent you.
          </p>
        </div>
      );
    }
    return (
      <div className={styles.grid} data-testid="workspaces-grid">
        {rows.map((row) => (
          <div
            key={row.namespaceId}
            className={styles.cardWrap}
            ref={menuOpenId === row.namespaceId ? menuRef : null}
            data-testid="workspace-card"
          >
            <button className={styles.card} onClick={() => open(row)}>
              <span
                className={styles.cardIcon}
                style={{ '--hue': hueOf(row.name) } as CSSProperties}
                aria-hidden="true"
              >
                {initials(row.name)}
              </span>
              <span className={styles.cardName}>{row.name}</span>
              <span className={styles.cardSub}>
                {row.agreementCount === 1
                  ? '1 agreement'
                  : `${row.agreementCount} agreements`}
                {' · '}
                {row.memberCount === 1
                  ? '1 person'
                  : `${row.memberCount} people`}
              </span>
              <span className={styles.cardFoot}>
                Open workspace <ArrowRight size={14} />
              </span>
            </button>
            <button
              className={`${styles.menuBtn} ${
                menuOpenId === row.namespaceId ? styles.menuBtnOpen : ''
              }`}
              title="More options"
              aria-label="More options"
              aria-expanded={menuOpenId === row.namespaceId}
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpenId(
                  menuOpenId === row.namespaceId ? null : row.namespaceId,
                );
              }}
            >
              <MoreHorizontal size={18} />
            </button>
            {menuOpenId === row.namespaceId && (
              <div className={styles.dropdown} role="menu">
                <button
                  className={styles.dropdownItem}
                  role="menuitem"
                  onClick={() => {
                    setMenuOpenId(null);
                    open(row);
                  }}
                >
                  <ArrowRight size={16} />
                  Open
                </button>
                <button
                  className={styles.dropdownItem}
                  role="menuitem"
                  data-testid="invite-to-workspace"
                  onClick={() => {
                    setMenuOpenId(null);
                    void invite(row);
                  }}
                >
                  <UserPlus size={16} />
                  Invite someone
                </button>
                <button
                  className={styles.dropdownItem}
                  role="menuitem"
                  onClick={() => {
                    setMenuOpenId(null);
                    void navigator.clipboard.writeText(row.namespaceId);
                  }}
                >
                  <Copy size={16} />
                  Copy id
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    );
  }, [
    banner,
    idLoading,
    invite,
    loading,
    menuOpenId,
    notInstalled,
    open,
    rows,
  ]);

  return (
    <AppShell>
      <main className={styles.main}>
        <header className={styles.pageHead}>
          <span className={styles.eyebrow}>Workspaces</span>
          <h1 className={styles.title}>Your workspaces</h1>
          <p className={styles.subtitle}>
            A workspace holds the people you sign with, and the agreements you
            sign with them. Invitations are to a workspace — one link covers
            everything in it.
          </p>
        </header>

        {banner && (
          <p
            className={banner.kind === 'error' ? styles.error : styles.notice}
            data-testid={banner.kind === 'error' ? 'list-error' : 'list-notice'}
          >
            {banner.text}
          </p>
        )}

        <section className={styles.panel}>
          <div className={styles.panelHead}>
            <span className={styles.panelIcon}>
              <Plus size={20} />
            </span>
            <div>
              <h2 className={styles.panelTitle}>New workspace</h2>
              <p className={styles.panelText}>
                Name it after the people or the deal — you can invite them as
                soon as it exists.
              </p>
            </div>
          </div>
          <div className={styles.createRow}>
            <input
              className={styles.input}
              placeholder="New workspace name…"
              aria-label="New workspace name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void create()}
              data-testid="new-workspace-name"
            />
            <button
              className={styles.btn}
              onClick={() => void create()}
              disabled={creating || !newName.trim() || !applicationId}
              data-testid="create-workspace"
            >
              {creating ? <span className={styles.spinner} /> : null}
              {creating ? 'Creating…' : 'Create'}
            </button>
          </div>
          {creating && status && <p className={styles.hint}>{status}</p>}
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <h2 className={styles.sectionTitle}>All workspaces</h2>
            {rows.length > 0 && (
              <span className={styles.count}>{rows.length}</span>
            )}
          </div>
          {body}
        </section>

        {/* ⚠️ NO SIGNATURE LIBRARY HERE. It used to sit on this screen, which
            is the app's ROOT — the list of workspaces you belong to. Your
            signatures are not a peer of your workspaces; they are a tool you
            reach for while working inside one. It lives on the agreements
            screen (and in the rail), where a document is about to be signed.

            The DATA is unchanged and deliberately so: a signature is stored
            in this node's own private context and is the same drawing in
            every workspace. Scoping the store per workspace would mean
            re-drawing your signature for each team, which is not what a
            signature is. Only the way in moved. */}
      </main>

      {inviteFor && (
        <div
          className={styles.modalBackdrop}
          onClick={() => setInviteFor(null)}
        >
          <div
            className={styles.modal}
            role="dialog"
            aria-modal="true"
            aria-labelledby="invite-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className={styles.modalTitle} id="invite-title">
              Invite to {inviteFor.name}
            </h2>
            <p className={styles.modalDesc}>
              Anyone with this link can join the workspace and its agreements.
              The node expires it after 24 hours.
            </p>
            {minting ? (
              <p className={styles.empty}>
                <span className={styles.spinner} /> Minting…
              </p>
            ) : (
              <textarea
                className={styles.textarea}
                readOnly
                value={inviteLink}
                data-testid="invite-link"
                onFocus={(e) => e.currentTarget.select()}
              />
            )}
            <div className={styles.modalRow}>
              <button
                className={styles.btnGhost}
                onClick={() => setInviteFor(null)}
              >
                Done
              </button>
              <button
                className={styles.btn}
                disabled={!inviteLink}
                onClick={() => void navigator.clipboard.writeText(inviteLink)}
              >
                <Copy size={16} />
                Copy link
              </button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
