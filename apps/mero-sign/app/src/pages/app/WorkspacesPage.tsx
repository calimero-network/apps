import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { AppHeader } from '../../components/AppHeader';
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
import { adminApi, apiClient } from '../../lib/node';
import { useCalimero } from '../../lib/useCalimero';
import { redeemInvitation } from '../../api/invitationJoin';
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
// mero-drive (workspace → folder).
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

  const [joinCode, setJoinCode] = useState('');
  const [joining, setJoining] = useState(false);

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

  useEffect(() => {
    if (app && !idLoading) void load();
  }, [app, idLoading, load]);

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
  }, [applicationId, navigate, newName]);

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

  const join = useCallback(async () => {
    const raw = joinCode.trim();
    if (!raw) return;
    setJoining(true);
    setBanner(null);
    try {
      const result = await redeemInvitation(raw, app);
      setJoinCode('');
      if (result.contextId) {
        navigate(`/agreements/${result.contextId}`);
      } else if (result.namespaceId) {
        // Joined the workspace, but it holds no single agreement to open —
        // none yet, or several. Both are ordinary, so land on the workspace.
        setActiveWorkspace(result.namespaceId);
        navigate(`/workspaces/${result.namespaceId}`);
      } else {
        await load();
      }
    } catch (error) {
      setBanner({
        kind: 'error',
        text:
          error instanceof Error
            ? error.message
            : 'Could not join with that invitation.',
      });
    } finally {
      setJoining(false);
    }
  }, [app, joinCode, load, navigate]);

  const body = useMemo(() => {
    if (notInstalled) {
      return (
        <p className={styles.empty} data-testid="not-installed">
          {NOT_INSTALLED_MESSAGE}
        </p>
      );
    }
    if (loading || idLoading) {
      return <p className={styles.empty}>Loading…</p>;
    }
    if (banner?.kind === 'error') return null;
    if (rows.length === 0) {
      return (
        <p className={styles.empty} data-testid="workspaces-empty">
          No workspaces yet. Create one above, or paste an invitation below.
        </p>
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
            </button>
            <button
              className={styles.menuBtn}
              title="More options"
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpenId(
                  menuOpenId === row.namespaceId ? null : row.namespaceId,
                );
              }}
            >
              ⋯
            </button>
            {menuOpenId === row.namespaceId && (
              <div className={styles.dropdown}>
                <button
                  className={styles.dropdownItem}
                  onClick={() => {
                    setMenuOpenId(null);
                    open(row);
                  }}
                >
                  Open
                </button>
                <button
                  className={styles.dropdownItem}
                  data-testid="invite-to-workspace"
                  onClick={() => {
                    setMenuOpenId(null);
                    void invite(row);
                  }}
                >
                  Invite someone
                </button>
                <button
                  className={styles.dropdownItem}
                  onClick={() => {
                    setMenuOpenId(null);
                    void navigator.clipboard.writeText(row.namespaceId);
                  }}
                >
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
    <div className={styles.root}>
      <AppHeader />

      <main className={styles.main}>
        <h1 className={styles.title}>Your workspaces</h1>
        <p className={styles.subtitle}>
          A workspace holds the people you sign with, and the agreements you
          sign with them. Invitations are to a workspace — one link covers
          everything in it.
        </p>

        {banner && (
          <p
            className={banner.kind === 'error' ? styles.error : styles.notice}
            data-testid={banner.kind === 'error' ? 'list-error' : 'list-notice'}
          >
            {banner.text}
          </p>
        )}

        <div className={styles.createRow}>
          <input
            className={styles.input}
            placeholder="New workspace name…"
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

        {body}

        <div className={styles.joinSection}>
          <p className={styles.joinLabel}>
            Got an invitation? Join a workspace.
          </p>
          <div className={styles.joinRow}>
            <input
              className={styles.input}
              placeholder="Paste the link or code you were sent…"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void join()}
              data-testid="join-code"
            />
            <button
              className={styles.btn}
              onClick={() => void join()}
              disabled={joining || !joinCode.trim()}
              data-testid="join-workspace"
            >
              {joining ? <span className={styles.spinner} /> : null}
              {joining ? 'Joining…' : 'Join'}
            </button>
          </div>
          <p className={styles.hint}>
            Opening the link works too — you only need this if it arrived as
            text.
          </p>
        </div>

        <div className={styles.joinSection}>
          <p className={styles.joinLabel}>Your signatures</p>
          <div className={styles.joinRow}>
            <button
              className={styles.btnGhost}
              onClick={() => navigate('/signatures')}
              data-testid="go-signatures"
            >
              Open signature library
            </button>
          </div>
        </div>
      </main>

      {inviteFor && (
        <div
          className={styles.modalBackdrop}
          onClick={() => setInviteFor(null)}
        >
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <h2 className={styles.modalTitle}>Invite to {inviteFor.name}</h2>
            <p className={styles.modalDesc}>
              Anyone with this link can join the workspace and its agreements.
              The node expires it after 24 hours.
            </p>
            {minting ? (
              <p className={styles.empty}>Minting…</p>
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
                className={styles.btn}
                disabled={!inviteLink}
                onClick={() => void navigator.clipboard.writeText(inviteLink)}
              >
                Copy link
              </button>
              <button
                className={styles.btnGhost}
                onClick={() => setInviteFor(null)}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
