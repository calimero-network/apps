import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';

import { AppHeader } from '../../components/AppHeader';
import {
  useActiveWorkspace,
  setActiveWorkspace,
} from '../../lib/activeWorkspace';
import {
  displayName,
  enterAgreement,
  listAgreements,
  type AgreementRow,
} from '../../lib/agreements';
import { adminApi } from '../../lib/node';
import { useCalimero } from '../../lib/useCalimero';
import { AgreementService } from '../../api/agreementService';
import styles from './AgreementsPage.module.css';

// ── The agreements in one workspace ─────────────────────────────────────────
//
// ── On the nouns ────────────────────────────────────────────────────────────
//
//   WORKSPACE  — the people. You invite people there. The previous screen.
//   AGREEMENT  — one document set, inside a workspace. This screen.
//   DOCUMENT   — the thing that gets signed, inside an agreement. The next one.
//
// Which is also how a person describes it: you are invited to work with
// someone, you draw up an agreement with them, and you sign the documents in
// it.
//
// ── Where this list comes from, and where it used to ────────────────────────
//
// The node, via `listNamespaceGroups` — the subgroups of this workspace, each
// with its context. It used to come from `listJoinedContexts`, which reads a
// registry this node writes into its own PRIVATE context at join time. That
// registry is a per-node snapshot: an agreement created on another node and
// replicated here was never written into it, so it did not appear until
// somebody re-joined it by link. The node's own listing cannot drift from what
// the node actually holds, and it is one call rather than one per agreement.
//
// The private registry is still written (see `settleIntoAgreement`) because
// four other call sites read it, but it is no longer what the list believes.

export default function AgreementsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams<{ workspaceId?: string }>();
  const stored = useActiveWorkspace();

  // The route is the source of truth when there is one — `/workspaces/:id` is
  // a shareable URL and it must win over whatever was last opened. `/agreements`
  // carries no id and falls back to the active workspace.
  const workspaceId = params.workspaceId ?? stored;

  // ⚠️ Passed EXPLICITLY, not left to the store. The store is updated in an
  // effect below, so on the first render after following a link to another
  // workspace it still holds the previous one — and `app.createContext` binds
  // a new agreement to whatever the handle was built with.
  const { app } = useCalimero(workspaceId);

  const [rows, setRows] = useState<AgreementRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // The stored workspace is not on this node. See `load`.
  const [gone, setGone] = useState(false);

  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);

  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const service = useMemo(() => new AgreementService(app), [app]);

  // Keep the store in step with the URL, so a reload and the rest of the app
  // agree about which workspace is open.
  useEffect(() => {
    if (params.workspaceId && params.workspaceId !== stored) {
      setActiveWorkspace(params.workspaceId);
    }
  }, [params.workspaceId, stored]);

  const load = useCallback(async () => {
    if (!workspaceId) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setRows(await listAgreements(adminApi(), workspaceId));
      setGone(false);
    } catch (e) {
      setRows([]);
      // ⚠️ A STORED WORKSPACE OUTLIVES THE NODE THAT HELD IT. The active
      // workspace is remembered in `localStorage` so a reload lands you back
      // where you were — but a node that has been reset, or a workspace
      // someone deleted, leaves that id pointing at nothing. It is still a
      // string, so nothing upstream treats it as absent: this screen rendered
      // its create box as usual and every action failed against a namespace
      // the node does not have.
      //
      // That is how pressing Create answered with a sentence naming
      // `lib/agreements`. Failing to list a workspace's subgroups IS the
      // evidence — there is nothing more to ask the node — so the selection
      // is dropped rather than reported, and the picker is offered instead.
      setGone(true);
      if (!params.workspaceId) setActiveWorkspace(null);
      setError(
        e instanceof Error ? e.message : 'Could not load your agreements.',
      );
    } finally {
      setLoading(false);
    }
  }, [workspaceId, params.workspaceId]);

  useEffect(() => {
    if (app) void load();
    // `location.key` so returning here after opening an agreement reloads the
    // list without a full page reload, which is what the old flow used.
  }, [app, load, location.key]);

  useEffect(() => {
    function onOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpenId(null);
      }
    }
    document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, []);

  const create = useCallback(async () => {
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    setError(null);
    try {
      const res = await service.createAgreement(name);
      if (res.error) {
        setError(res.error.message);
        return;
      }
      setNewName('');
      await load();
    } finally {
      setCreating(false);
    }
  }, [load, newName, service]);

  const open = useCallback(
    async (row: AgreementRow) => {
      if (!row.contextId || !workspaceId) return;
      setOpening(row.agreementId);
      setError(null);
      try {
        // ⚠️ ENTERING IS A STEP. Being in the workspace does not put you in its
        // agreements — a subgroup is joined by inheritance, and until that has
        // happened this node holds no identity in the agreement's context and
        // every contract call from the next screen is refused. `enterAgreement`
        // is a no-op once you are in, so opening a second time costs one read.
        const identity = await enterAgreement(adminApi(), {
          namespaceId: workspaceId,
          agreementId: row.agreementId,
          contextId: row.contextId,
        });
        // The agreement screens still read these two out of storage; the route
        // param is the source of truth and this keeps them in step.
        localStorage.setItem('agreementContextID', row.contextId);
        localStorage.setItem('agreementContextUserID', identity);
        navigate(`/agreements/${row.contextId}`);
      } catch (e) {
        setError(
          e instanceof Error ? e.message : 'Could not open that agreement.',
        );
      } finally {
        setOpening(null);
      }
    },
    [navigate, workspaceId],
  );

  if (gone) {
    return (
      <div className={styles.root}>
        <AppHeader />
        <main className={styles.main}>
          <h1 className={styles.title}>That workspace is not on this node</h1>
          <p className={styles.subtitle}>
            It was remembered from a previous session, but this node does not
            have it — it may have been reset, or the workspace deleted. Nothing
            of yours is lost; pick a workspace to carry on.
          </p>
          {error && (
            <p className={styles.error} data-testid="list-error">
              {error}
            </p>
          )}
          <div className={styles.joinRow}>
            <button
              className={styles.btn}
              onClick={() => navigate('/workspaces')}
              data-testid="go-workspaces"
            >
              Choose a workspace
            </button>
          </div>
        </main>
      </div>
    );
  }

  if (!workspaceId) {
    return (
      <div className={styles.root}>
        <AppHeader />
        <main className={styles.main}>
          <h1 className={styles.title}>Your agreements</h1>
          <p className={styles.subtitle}>
            An agreement lives in a workspace — the group of people who sign it.
            Open or create one to get started.
          </p>
          <div className={styles.joinRow}>
            <button
              className={styles.btn}
              onClick={() => navigate('/workspaces')}
              data-testid="go-workspaces"
            >
              Choose a workspace
            </button>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className={styles.root}>
      <AppHeader back={{ label: 'Workspaces', to: '/workspaces' }} />

      <main className={styles.main}>
        <h1 className={styles.title}>Agreements</h1>
        <p className={styles.subtitle}>
          An agreement holds the documents a group of people sign. Everything in
          one lives on the nodes of the people invited to this workspace.
        </p>

        {error && (
          <p className={styles.error} data-testid="list-error">
            {error}
          </p>
        )}

        <div className={styles.createRow}>
          <input
            className={styles.input}
            placeholder="New agreement name…"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void create()}
            data-testid="new-agreement-name"
          />
          <button
            className={styles.btn}
            onClick={() => void create()}
            disabled={creating || !newName.trim()}
            data-testid="create-agreement"
          >
            {creating ? <span className={styles.spinner} /> : null}
            {creating ? 'Creating…' : 'Create'}
          </button>
        </div>

        {loading ? (
          <p className={styles.empty}>Loading…</p>
        ) : error ? null /* the error above already says why the list is empty;
                            "No agreements yet. Create one above" underneath it
                            contradicts it */ : rows.length === 0 ? (
          <p className={styles.empty} data-testid="agreements-empty">
            No agreements yet. Create one above.
          </p>
        ) : (
          <div className={styles.grid} data-testid="agreements-grid">
            {rows.map((row) => (
              <div
                key={row.agreementId}
                className={styles.cardWrap}
                ref={menuOpenId === row.agreementId ? menuRef : null}
                data-testid="agreement-card"
              >
                <button
                  className={styles.card}
                  disabled={!row.contextId || opening === row.agreementId}
                  onClick={() => void open(row)}
                >
                  <span className={styles.cardName}>
                    {displayName([row.name], row.agreementId, 'Agreement')}
                  </span>
                  <span className={styles.cardSub}>
                    {!row.contextId
                      ? 'Still replicating…'
                      : opening === row.agreementId
                        ? 'Opening…'
                        : row.joined
                          ? `${row.memberCount === 1 ? '1 person' : `${row.memberCount} people`}`
                          : 'Not joined yet'}
                  </span>
                </button>
                <button
                  className={styles.menuBtn}
                  title="More options"
                  onClick={(e) => {
                    e.stopPropagation();
                    setMenuOpenId(
                      menuOpenId === row.agreementId ? null : row.agreementId,
                    );
                  }}
                >
                  ⋯
                </button>
                {menuOpenId === row.agreementId && (
                  <div className={styles.dropdown}>
                    <button
                      className={styles.dropdownItem}
                      disabled={!row.contextId}
                      onClick={() => {
                        setMenuOpenId(null);
                        void open(row);
                      }}
                    >
                      Open
                    </button>
                    <button
                      className={styles.dropdownItem}
                      onClick={() => {
                        setMenuOpenId(null);
                        void navigator.clipboard.writeText(
                          row.contextId ?? row.agreementId,
                        );
                      }}
                    >
                      Copy id
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Inside the workspace, next to the agreements it will be used on —
            not on the root screen beside the workspace list. See the note in
            `WorkspacesPage`. */}
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
          <p className={styles.hint}>
            The drawings you sign with. They stay in your own private context
            and never leave your node, so they are the same in every workspace.
          </p>
        </div>

        <div className={styles.joinSection}>
          <p className={styles.joinLabel}>
            Inviting someone? Invitations are to the workspace.
          </p>
          <div className={styles.joinRow}>
            <button
              className={styles.btnGhost}
              onClick={() => navigate('/workspaces')}
              data-testid="go-workspaces"
            >
              Manage workspaces
            </button>
          </div>
          <p className={styles.hint}>
            One link covers the workspace and every agreement in it, so a signer
            you already work with does not need a new one for each document.
          </p>
        </div>
      </main>
    </div>
  );
}
