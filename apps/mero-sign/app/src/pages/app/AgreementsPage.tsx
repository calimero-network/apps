import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { askAnOwnerCopy, canCreateIn } from '@calimero-apps/connect';
import {
  ArrowRight,
  Copy,
  FileSignature,
  Layers,
  MoreHorizontal,
  PenLine,
  Plus,
  UserPlus,
} from 'lucide-react';

import { AppShell } from '../../components/shell/AppShell';
import { hueOf } from '../../lib/monogram';
import {
  useActiveWorkspace,
  setActiveWorkspace,
} from '../../lib/activeWorkspace';
import {
  createAgreement,
  displayName,
  enterAgreement,
  listAgreements,
  listWorkspaces,
  type AgreementRow,
} from '../../lib/agreements';
import { errorMessage, setContextId } from '../../lib/node';
import { useCalimero } from '../../lib/useCalimero';
import styles from './AgreementsPage.module.css';

// ── The agreements in one workspace ─────────────────────────────────────────
//
//   WORKSPACE  — the people (an organization). The previous screen.
//   AGREEMENT  — one document set: an app instance in the organization. This screen.
//   DOCUMENT   — the thing that gets signed, inside an agreement. The next one.
//
// The list is the app's instances in this workspace's organization, read from
// the cluster: every member of the organization reaches every one of them, and
// nothing has to replicate first.

export default function AgreementsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams<{ workspaceId?: string }>();
  const stored = useActiveWorkspace();

  // The route is the source of truth when there is one — `/workspaces/:id` is
  // a shareable URL and it must win over whatever was last opened. `/agreements`
  // carries no id and falls back to the active workspace.
  const workspaceId = params.workspaceId ?? stored;
  const { app } = useCalimero(workspaceId);

  const [rows, setRows] = useState<AgreementRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** The remembered workspace is not one this account is in any more. */
  const [gone, setGone] = useState(false);

  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  /**
   * Whether this account may add an agreement in the workspace (core's
   * `CREATE_APP`): an owner or admin, or a member allowed to (the workspace's
   * defaults, set by a best-effort step-up when it was made). `null` while
   * unknown, when the create is offered and the node decides.
   */
  const [mayCreate, setMayCreate] = useState<boolean | null>(null);
  const [opening, setOpening] = useState<string | null>(null);

  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // A followed `/workspaces/:id` link becomes the active workspace.
  useEffect(() => {
    if (params.workspaceId && params.workspaceId !== stored) {
      setActiveWorkspace(params.workspaceId);
    }
  }, [params.workspaceId, stored]);

  const load = useCallback(async () => {
    if (!workspaceId || !app) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    void canCreateIn(app.client, workspaceId).then(setMayCreate);
    try {
      setRows(
        await listAgreements(app.client, app.source, workspaceId, app.accountId),
      );
      setGone(false);
    } catch (e) {
      setRows([]);
      setError(errorMessage(e));
      // A remembered workspace this account is no longer in: say so, rather
      // than an error with no way forward.
      const known = await listWorkspaces(app.client, app.source).catch(
        () => null,
      );
      if (!known) return;
      if (known.some((w) => w.namespaceId === workspaceId)) return;
      setGone(true);
      if (!params.workspaceId) setActiveWorkspace(null);
    } finally {
      app.after();
      setLoading(false);
    }
  }, [workspaceId, params.workspaceId, app]);

  // Keyed on the navigation too: an accepted invitation lands here by
  // navigating, and the list has to reload.
  useEffect(() => {
    if (app) void load();
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
    if (!name || !app || !workspaceId) return;
    setCreating(true);
    setError(null);
    try {
      // The instance, its setup (the creator is its first admin), and a
      // record of it in the creator's private library.
      await createAgreement(
        app.client,
        {
          source: app.source,
          org: workspaceId,
          name,
          accountId: app.accountId,
          passkey: app.passkey,
        },
        undefined,
        app.after,
      );
      setNewName('');
      await load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      app.after();
      setCreating(false);
    }
  }, [app, load, newName, workspaceId]);

  const open = useCallback(
    async (row: AgreementRow) => {
      if (!app || !workspaceId) return;
      setOpening(row.agreementId);
      setError(null);
      try {
        // On the roster as a signer if not yet (a member of the workspace
        // joins by themselves), and recorded in the private library.
        await enterAgreement(
          app.client,
          {
            source: app.source,
            appId: row.contextId,
            accountId: app.accountId,
            name: row.name,
          },
          app.after,
        );
        setContextId(row.contextId);
        navigate(`/agreements/${row.contextId}`);
      } catch (e) {
        setError(errorMessage(e));
      } finally {
        setOpening(null);
      }
    },
    [app, navigate, workspaceId],
  );

  if (gone) {
    return (
      <AppShell>
        <main className={styles.main}>
          <header className={styles.pageHead}>
            <span className={styles.eyebrow}>Agreements</span>
            <h1 className={styles.title}>You are not in that workspace</h1>
            <p className={styles.subtitle}>
              It was remembered from a previous session, but your account is
              not in it any more — you may have left, or it was deleted.
              Nothing of yours is lost; pick a workspace to carry on.
            </p>
          </header>
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
              <Layers size={16} />
              Choose a workspace
            </button>
          </div>
        </main>
      </AppShell>
    );
  }

  if (!workspaceId) {
    return (
      <AppShell>
        <main className={styles.main}>
          <header className={styles.pageHead}>
            <span className={styles.eyebrow}>Agreements</span>
            <h1 className={styles.title}>Your agreements</h1>
            <p className={styles.subtitle}>
              An agreement lives in a workspace — the group of people who sign
              it. Open or create one to get started.
            </p>
          </header>
          <div className={styles.emptyState}>
            <span className={styles.emptyIcon}>
              <Layers size={24} />
            </span>
            <p className={styles.emptyTitle}>No workspace open</p>
            <p className={styles.empty}>
              Pick the workspace whose agreements you want to see.
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
          </div>
        </main>
      </AppShell>
    );
  }

  return (
    <AppShell back={{ label: 'Workspaces', to: '/workspaces' }}>
      <main className={styles.main}>
        <header className={styles.pageHead}>
          <span className={styles.eyebrow}>Workspace</span>
          <h1 className={styles.title}>Agreements</h1>
          <p className={styles.subtitle}>
            An agreement holds the documents a group of people sign. Everyone
            invited to this workspace can open it.
          </p>
        </header>

        {error && (
          <p className={styles.error} data-testid="list-error">
            {error}
          </p>
        )}

        <section className={styles.panel}>
          <div className={styles.panelHead}>
            <span className={styles.panelIcon}>
              <Plus size={20} />
            </span>
            <div>
              <h2 className={styles.panelTitle}>New agreement</h2>
              <p className={styles.panelText}>
                One agreement per set of documents — an NDA, a contract, a
                term sheet.
              </p>
            </div>
          </div>
          {mayCreate === false ? (
            <p className={styles.panelText} data-testid="create-agreement-ask">
              {askAnOwnerCopy('an agreement')}
            </p>
          ) : (
            <div className={styles.createRow}>
              <input
                className={styles.input}
                placeholder="New agreement name…"
                aria-label="New agreement name"
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
          )}
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <h2 className={styles.sectionTitle}>In this workspace</h2>
            {rows.length > 0 && (
              <span className={styles.count}>{rows.length}</span>
            )}
          </div>
          {loading ? (
            <div className={styles.skeletonGrid} aria-label="Loading…">
              <span className={styles.skeleton} />
              <span className={styles.skeleton} />
              <span className={styles.skeleton} />
            </div>
          ) : error ? null /* the error above already says why the list is
                              empty; "No agreements yet. Create one above"
                              underneath it contradicts it */ : rows.length ===
            0 ? (
            <div className={styles.emptyState}>
              <span className={styles.emptyIcon}>
                <FileSignature size={24} />
              </span>
              <p className={styles.emptyTitle}>Nothing to sign yet</p>
              <p className={styles.empty} data-testid="agreements-empty">
                {mayCreate === false
                  ? 'No agreements yet.'
                  : 'No agreements yet. Create one above.'}
              </p>
            </div>
          ) : (
            <div className={styles.grid} data-testid="agreements-grid">
              {rows.map((row) => {
                const name = displayName([row.name], row.agreementId, 'Agreement');
                return (
                  <div
                    key={row.agreementId}
                    className={styles.cardWrap}
                    ref={menuOpenId === row.agreementId ? menuRef : null}
                    data-testid="agreement-card"
                  >
                    <button
                      className={styles.card}
                      disabled={opening === row.agreementId}
                      onClick={() => void open(row)}
                    >
                      <span
                        className={styles.cardIcon}
                        style={{ '--hue': hueOf(name) } as CSSProperties}
                        aria-hidden="true"
                      >
                        <FileSignature size={20} />
                      </span>
                      <span className={styles.cardName}>{name}</span>
                      <span className={styles.cardSub}>
                        {opening === row.agreementId
                            ? 'Opening…'
                            : row.joined
                              ? `${row.memberCount === 1 ? '1 person' : `${row.memberCount} people`}`
                              : 'Not joined yet'}
                      </span>
                      <span className={styles.cardFoot}>
                        Open agreement <ArrowRight size={14} />
                      </span>
                    </button>
                    <button
                      className={`${styles.menuBtn} ${
                        menuOpenId === row.agreementId ? styles.menuBtnOpen : ''
                      }`}
                      title="More options"
                      aria-label="More options"
                      aria-expanded={menuOpenId === row.agreementId}
                      onClick={(e) => {
                        e.stopPropagation();
                        setMenuOpenId(
                          menuOpenId === row.agreementId
                            ? null
                            : row.agreementId,
                        );
                      }}
                    >
                      <MoreHorizontal size={18} />
                    </button>
                    {menuOpenId === row.agreementId && (
                      <div className={styles.dropdown} role="menu">
                        <button
                          className={styles.dropdownItem}
                          role="menuitem"
                          onClick={() => {
                            setMenuOpenId(null);
                            void open(row);
                          }}
                        >
                          <ArrowRight size={16} />
                          Open
                        </button>
                        <button
                          className={styles.dropdownItem}
                          role="menuitem"
                          onClick={() => {
                            setMenuOpenId(null);
                            void navigator.clipboard.writeText(
                              row.contextId,
                            );
                          }}
                        >
                          <Copy size={16} />
                          Copy id
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <div className={styles.panelPair}>
          {/* Inside the workspace, next to the agreements it will be used
              on — not on the root screen beside the workspace list. See the
              note in `WorkspacesPage`. */}
          <section className={styles.panel}>
            <div className={styles.panelHead}>
              <span className={styles.panelIcon}>
                <PenLine size={20} />
              </span>
              <div>
                <h2 className={styles.panelTitle}>Your signatures</h2>
                <p className={styles.panelText}>
                  The drawings you sign with. They stay in your own private
                  library, so they are the same in
                  every workspace.
                </p>
              </div>
            </div>
            <div className={styles.joinRow}>
              <button
                className={styles.btnGhost}
                onClick={() => navigate('/signatures')}
                data-testid="go-signatures"
              >
                Open signature library
              </button>
            </div>
          </section>

          <section className={styles.panel}>
            <div className={styles.panelHead}>
              <span className={styles.panelIcon}>
                <UserPlus size={20} />
              </span>
              <div>
                <h2 className={styles.panelTitle}>
                  Inviting someone? Invitations are to the workspace.
                </h2>
                <p className={styles.panelText}>
                  One link covers the workspace and every agreement in it, so a
                  signer you already work with does not need a new one for
                  each document.
                </p>
              </div>
            </div>
            <div className={styles.joinRow}>
              <button
                className={styles.btnGhost}
                onClick={() => navigate('/workspaces')}
                data-testid="go-workspaces"
              >
                Manage workspaces
              </button>
            </div>
          </section>
        </div>
      </main>
    </AppShell>
  );
}
