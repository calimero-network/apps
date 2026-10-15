import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMero } from '@calimero-network/mero-react';
import { publishMemberName, useMemberNames } from '@calimero-apps/names';
import {
  CheckCircle2,
  Clock,
  Copy,
  Eye,
  FileSignature,
  FileText,
  Link2,
  MoreHorizontal,
  PenLine,
  Trash2,
  Upload,
  UploadCloud,
  UserPlus,
  Users,
  type LucideIcon,
} from 'lucide-react';
import {
  apiClient,
  getExecutorPublicKey,
  setContextId,
  setExecutorPublicKey,
  useCalimero,
  type ResponseData,
} from '../../lib/node';
import type { ContextInviteByOpenInvitationResponse } from '../../lib/node';
import { ClientApiDataSource } from '../../api/dataSource/ClientApiDataSource';
import { ContextApiDataSource } from '../../api/dataSource/nodeApiDataSource';
import { DocumentService } from '../../api/documentService';
import {
  PermissionLevel,
  type ContextDetails,
  type Document as DocumentRow,
} from '../../api/clientApi';
import { useActiveWorkspace } from '../../lib/activeWorkspace';
import { blobClient } from '../../lib/node';
import { toBlobIdHex } from '../../lib/blobIds';
import { fetchWhileSyncing } from '../../lib/fetchWhileSyncing';
import {
  integrityWarning,
  verifyDocumentBytes,
} from '../../lib/documentIntegrity';
import { encodeInvite } from '../../lib/inviteCodec';
import { invitationUrl } from '../../lib/inviteLink';
import {
  INVITABLE_LEVELS,
  INVITE_LEVEL_LABELS,
  LEVEL_DESCRIPTIONS,
  buildRoster,
  canRemove,
  isAdmin,
  isHexId,
  levelChangesFor,
  participantInitials,
  participantName,
  toHexId,
} from '../../lib/participants';
import { AppShell } from '../../components/shell/AppShell';
import PDFViewer from '../../components/PDFViewer';
import styles from './AgreementPage.module.css';

// ── One agreement ────────────────────────────────────────────────────────────
//
// mero-design's Projects screen: the same header, the same tab strip, the same
// card grid and `⋯` menu, in CSS copied verbatim from it.
//
// Three tabs, because the screen answers three questions and used to answer
// them in one scrolling column with a collapsible panel bolted to the side:
// what is in this agreement, who is in it, and how do I get somebody else in.

type Tab = 'documents' | 'people' | 'invite';

const TABS: { id: Tab; label: string; icon: LucideIcon }[] = [
  { id: 'documents', label: 'Documents', icon: FileText },
  { id: 'people', label: 'People', icon: Users },
  { id: 'invite', label: 'Invite', icon: UserPlus },
];

function statusClass(status: string): string {
  if (status === 'FullySigned') return styles.badgeSigned;
  if (status === 'PartiallySigned') return styles.badgePartial;
  return styles.badgePending;
}

/** The card's stage tint, so three documents do not read as three identical
 *  grey rectangles. Green only for the completed one. */
function thumbClass(status: string): string {
  if (status === 'FullySigned') return styles.thumbSigned;
  return styles.thumbPartial;
}

function statusIcon(status: string) {
  if (status === 'FullySigned') return <CheckCircle2 size={13} />;
  if (status === 'PartiallySigned') return <PenLine size={13} />;
  return <Clock size={13} />;
}

function statusLabel(status: string): string {
  if (status === 'FullySigned') return 'Signed';
  if (status === 'PartiallySigned') return 'In progress';
  return 'Awaiting signatures';
}

export default function AgreementPage() {
  const navigate = useNavigate();
  const { agreementId } = useParams();
  const { app } = useCalimero();

  const clientApi = useMemo(() => new ClientApiDataSource(app), [app]);
  const nodeApi = useMemo(() => new ContextApiDataSource(app), [app]);
  const documentService = useMemo(() => new DocumentService(), []);

  // The route param is the source of truth; storage is kept in step because the
  // PDF viewer and the consent flow still read it.
  const contextId =
    agreementId || localStorage.getItem('agreementContextID') || '';
  const executorKey = localStorage.getItem('agreementContextUserID') || '';
  useEffect(() => {
    if (contextId) localStorage.setItem('agreementContextID', contextId);
  }, [contextId]);

  const [tab, setTab] = useState<Tab>('documents');
  const [details, setDetails] = useState<ContextDetails | null>(null);
  const [selfAccountId, setSelfAccountId] = useState('');
  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  const [viewing, setViewing] = useState<DocumentRow | null>(null);
  // ⚠️ THE VIEWER WAS PASSED `file={null}`, HARDCODED. Nothing ever fetched
  // the document's bytes, so opening any document — however healthy —
  // rendered "No PDF selected. Please upload a PDF to get started.", forever,
  // for everyone. The blob id was sitting on the row the whole time.
  const [viewingFile, setViewingFile] = useState<File | null>(null);
  // Set when the fetched bytes do not hash to what the agreement recorded.
  const [integrity, setIntegrity] = useState<string | null>(null);
  const [viewingError, setViewingError] = useState<string | null>(null);

  // ⚠️ A SECOND WAY OUT, that does not depend on the viewer rendering one.
  // `PDFViewer` early-returns for loading, error and no-file, and none of
  // those branches used to render its close button — so a document that
  // failed to load opened a modal with no exit. Those branches are fixed too,
  // but Escape and a backdrop click are the escapes that cannot be forgotten
  // by a future branch.
  useEffect(() => {
    if (!viewing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setViewing(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [viewing]);

  // Fetch the bytes whenever a document is opened, and drop them when it is
  // closed so a second open cannot show the first one's pages.
  useEffect(() => {
    if (!viewing) {
      setViewingFile(null);
      setViewingError(null);
      setIntegrity(null);
      return;
    }
    let cancelled = false;
    setViewingFile(null);
    setViewingError(null);
    setIntegrity(null);
    void (async () => {
      try {
        // Hex — and `toBlobIdHex` also accepts the base58 ids written before
        // that was fixed, so documents uploaded by an older build still open.
        const blobId = toBlobIdHex(viewing.pdfBlobId);
        if (!blobId) {
          throw new Error(
            'This document has no readable blob id recorded against it.',
          );
        }
        // Listed is not yet fetched: the agreement's state syncs before the
        // node has the bytes, so keep asking while it catches up ("Loading…"
        // stays up) rather than failing on the first refusal.
        const blob = await fetchWhileSyncing(
          () => blobClient.downloadBlob(blobId, contextId),
          { cancelled: () => cancelled },
        );
        if (cancelled) return;

        // The hash has always been recorded and shown; nothing ever checked
        // it, so a blob that came back as something else rendered without a
        // word. A mismatch warns rather than blocking — see `documentIntegrity`.
        const integrity = await verifyDocumentBytes(
          await blob.arrayBuffer(),
          viewing.hash,
        );
        if (cancelled) return;
        setIntegrity(integrityWarning(integrity));

        setViewingFile(
          new File([blob], viewing.name || 'document.pdf', {
            type: 'application/pdf',
          }),
        );
      } catch (e) {
        if (cancelled) return;
        setViewingError(
          e instanceof Error ? e.message : 'Could not load that document.',
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [viewing, contextId]);
  const [roleBusyFor, setRoleBusyFor] = useState<string | null>(null);

  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [mintingInvite, setMintingInvite] = useState(false);
  // ⚠️ An invitation is to the WORKSPACE, not to this agreement. See below.
  const workspaceId = useActiveWorkspace();
  // People by the name they set for the workspace (namespace member metadata,
  // shared by every app on it), not by account id.
  const { admin } = useMero();
  const { nameOf } = useMemberNames(admin, workspaceId);
  const personName = useCallback(
    (id: string) => participantName(id, nameOf),
    [nameOf],
  );
  const [myName, setMyName] = useState('');
  const [savingName, setSavingName] = useState(false);
  const [inviteeId, setInviteeId] = useState('');
  // Defaults to Signer because that is what inviting somebody to an agreement
  // ordinarily means, and the picker states the consequence rather than
  // relying on a safe default that fights the common case. An admin can
  // change it later from the People tab.
  const [inviteeLevel, setInviteeLevel] = useState<PermissionLevel>(
    PermissionLevel.Sign,
  );
  const [targetedLink, setTargetedLink] = useState('');

  const flash = useCallback((message: string) => {
    setNotice(message);
    setTimeout(() => setNotice(null), 2500);
  }, []);

  // ── loading ───────────────────────────────────────────────────────────────
  const loadDetails = useCallback(async () => {
    if (!contextId) return;
    try {
      if (executorKey) setExecutorPublicKey(executorKey);
      const res = await clientApi.getContextDetails(
        contextId,
        contextId,
        executorKey || undefined,
      );
      if (res.error) {
        setError(res.error.message);
        setDetails(null);
      } else {
        setError(null);
        setDetails(res.data ?? null);
      }

      // Which roster row is me. The app cannot work this out for itself — the
      // key in storage is the context member (DEVICE) key while permissions are
      // keyed by ACCOUNT, and both are 64 hex characters. `whoami()` exists for
      // exactly this. "" means nobody is badged and no role control is offered,
      // which is the safe reading.
      const me = await clientApi.whoami(contextId, executorKey || undefined);
      setSelfAccountId(me.data ? toHexId(me.data) : '');
    } catch {
      setError('Could not load this agreement.');
    }
  }, [clientApi, contextId, executorKey]);

  const loadDocuments = useCallback(async () => {
    if (!contextId) return;
    try {
      const res = await documentService.listDocuments(
        contextId,
        contextId,
        executorKey || undefined,
      );
      setDocuments(res.data ?? []);
    } catch {
      setDocuments([]);
    }
  }, [documentService, contextId, executorKey]);

  useEffect(() => {
    if (!app || !contextId) return;
    let cancelled = false;
    void (async () => {
      setLoading(true);
      await loadDetails();
      await loadDocuments();
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [app, contextId, loadDetails, loadDocuments]);

  useEffect(() => {
    function onOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpenId(null);
      }
    }
    document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, []);

  // ── roles ─────────────────────────────────────────────────────────────────
  const roster = useMemo(
    () => buildRoster(details?.participants ?? [], selfAccountId),
    [details, selfAccountId],
  );
  const iAmAdmin = useMemo(
    () => isAdmin(roster, selfAccountId),
    [roster, selfAccountId],
  );

  const changeLevel = useCallback(
    async (userId: string, level: PermissionLevel) => {
      setRoleBusyFor(userId);
      try {
        const res = await clientApi.setParticipantPermission(
          userId,
          level,
          contextId,
          executorKey || undefined,
        );
        if (res.error) {
          setError(res.error.message || 'Could not change that role.');
          return;
        }
        flash(`${personName(userId)} is now ${level}.`);
        await loadDetails();
      } finally {
        setRoleBusyFor(null);
      }
    },
    [clientApi, contextId, executorKey, flash, loadDetails, personName],
  );

  const remove = useCallback(
    async (userId: string) => {
      setRoleBusyFor(userId);
      try {
        const res = await clientApi.removeParticipant(
          userId,
          contextId,
          executorKey || undefined,
        );
        if (res.error) {
          setError(res.error.message || 'Could not remove that person.');
          return;
        }
        flash(`${personName(userId)} removed.`);
        await loadDetails();
      } finally {
        setRoleBusyFor(null);
      }
    },
    [clientApi, contextId, executorKey, flash, loadDetails, personName],
  );

  // Publish the name every app on this workspace shows for this account.
  const saveMyName = useCallback(async () => {
    const name = myName.trim();
    if (!admin || !workspaceId || !selfAccountId || !name) return;
    setSavingName(true);
    try {
      await publishMemberName(admin, workspaceId, selfAccountId, name);
      setMyName('');
      flash(`Everyone in this workspace now sees you as ${name}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save your name.');
    } finally {
      setSavingName(false);
    }
  }, [admin, workspaceId, selfAccountId, myName, flash]);

  // ── invitations ───────────────────────────────────────────────────────────
  const mintLink = useCallback(async () => {
    if (!contextId || !executorKey) {
      setError('This agreement is not open on your node yet.');
      return;
    }
    // ⚠️ THE NAMESPACE, NOT THE CONTEXT — this is the reported
    // `{"error":"Internal server error"}` on Create invitation.
    //
    // `contextInviteByOpenInvitation` is a kept NAME, not a kept meaning:
    // since the workspace model it posts to
    // `POST /admin-api/namespaces/<id>/invite`. This call site still handed it
    // `getContextId() || contextId`, so the node was asked to mint an
    // invitation for a namespace whose id is actually a context's — it has no
    // such namespace, and the lookup fails as a bare 500 that names nothing.
    //
    // The grant was never per-agreement anyway: an invitation admits someone
    // to the workspace, and the agreements inside it are reached by
    // inheritance from there. See `lib/agreements`.
    if (!workspaceId) {
      setError(
        'Open this agreement from its workspace first — an invitation is to ' +
          'the workspace, and this page does not know which one you came from.',
      );
      return;
    }
    setMintingInvite(true);
    try {
      setContextId(contextId);
      setExecutorPublicKey(executorKey);
      const res: ResponseData<ContextInviteByOpenInvitationResponse> =
        await apiClient.node().contextInviteByOpenInvitation(
          workspaceId,
          getExecutorPublicKey() || executorKey,
          // `validForBlocks`. Core clamps an open invitation to 24 hours
          // whatever is asked for, so this is "as long as it will allow".
          86400,
        );
      if (res.error || !res.data) {
        setError(res.error?.message || 'Could not create an invitation.');
        return;
      }
      // The node's raw body. Core wraps it; older nodes did not. Accept either.
      const envelope = res.data as unknown as Record<string, unknown>;
      const signed = (envelope.data ?? envelope) as Parameters<
        typeof encodeInvite
      >[0]['invitation'];
      if (!signed || typeof signed !== 'object' || !signed.invitation) {
        setError('The node returned an invitation this app cannot read.');
        return;
      }
      const code = encodeInvite({
        invitation: signed,
        contextId,
        // A display hint, outside the signature, so the recipient's prompt can
        // name the agreement before they commit. The contract's own
        // `context_name` supersedes it the moment they join.
        contextName: details?.context_name,
      });
      setInviteLink(invitationUrl(code));
    } finally {
      setMintingInvite(false);
    }
  }, [contextId, executorKey, details, workspaceId]);

  const mintTargeted = useCallback(async () => {
    const id = inviteeId.trim();
    if (!isHexId(id)) {
      setError('That is not a Calimero id — it should be 64 hex characters.');
      return;
    }
    setMintingInvite(true);
    try {
      const res = await nodeApi.inviteToContext({
        contextId,
        inviter: executorKey,
        invitee: id,
      });
      if (res.error || !res.data) {
        setError(res.error?.message || 'Could not create that invitation.');
        return;
      }
      // ⚠️ WAS HARDCODED `PermissionLevel.Sign`, so every person ever invited
      // became a signer and the `Read` level — which the contract enforces and
      // this UI describes — was unreachable in the product. It was also
      // unusable even if you reached it: completion demanded a signature from
      // every participant regardless of level, so one viewer meant no document
      // in the agreement could ever finish. Both halves are fixed; this is the
      // half that lets anyone ask for a viewer.
      await clientApi.addParticipant(
        contextId,
        id,
        inviteeLevel,
        contextId,
        executorKey || undefined,
      );
      // A link like any other: the invitee opens it, and the payload is
      // useless to anyone but the identity it names.
      setTargetedLink(invitationUrl(res.data));
    } finally {
      setMintingInvite(false);
    }
  }, [inviteeId, inviteeLevel, nodeApi, clientApi, contextId, executorKey]);

  const copy = useCallback(
    (value: string, what: string) => {
      void navigator.clipboard.writeText(value);
      flash(`${what} copied.`);
    },
    [flash],
  );

  // ── documents ─────────────────────────────────────────────────────────────
  const upload = useCallback(async () => {
    if (!uploadFile) return;
    setUploading(true);
    try {
      const res = await documentService.uploadDocument(
        contextId,
        uploadFile.name,
        uploadFile,
        contextId,
        executorKey || undefined,
      );
      if (res.error) {
        setError(res.error.message || 'Could not upload that document.');
        return;
      }
      setUploadOpen(false);
      setUploadFile(null);
      await loadDocuments();
      flash('Document uploaded.');
    } finally {
      setUploading(false);
    }
  }, [
    uploadFile,
    documentService,
    contextId,
    executorKey,
    loadDocuments,
    flash,
  ]);

  const removeDocument = useCallback(
    async (doc: DocumentRow) => {
      setMenuOpenId(null);
      const res = await clientApi.deleteDocument(
        doc.id,
        contextId,
        executorKey || undefined,
      );
      if (res.error) {
        setError(res.error.message || 'Could not delete that document.');
        return;
      }
      await loadDocuments();
      flash('Document deleted.');
    },
    [clientApi, contextId, executorKey, loadDocuments, flash],
  );

  const name = details?.context_name?.trim() || 'Agreement';

  return (
    <AppShell back={{ label: 'Agreements', to: '/agreements' }}>
      <main className={styles.main}>
        <header className={styles.hero}>
          <span className={styles.heroIcon} aria-hidden="true">
            <FileSignature size={26} />
          </span>
          <div className={styles.heroText}>
            <span className={styles.eyebrow}>Agreement</span>
            <h1 className={styles.title} data-testid="agreement-title">
              {name}
            </h1>
            <p className={styles.subtitle}>
              {details ? (
                <>
                  <span className={styles.metaChip}>
                    <Users size={14} />
                    {details.participant_count}{' '}
                    {details.participant_count === 1 ? 'person' : 'people'}
                  </span>
                  <span className={styles.metaChip}>
                    <FileText size={14} />
                    {documents.length}{' '}
                    {documents.length === 1 ? 'document' : 'documents'}
                  </span>
                </>
              ) : (
                'Loading…'
              )}
            </p>
          </div>
        </header>

        <div className={styles.tabs} role="tablist" aria-label="Agreement">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              className={`${styles.tab} ${tab === t.id ? styles.tabActive : ''}`}
              onClick={() => setTab(t.id)}
              data-testid={`tab-${t.id}`}
            >
              <t.icon size={16} />
              {t.label}
            </button>
          ))}
        </div>

        {notice && (
          <p className={styles.notice} data-testid="notice">
            <CheckCircle2 size={16} />
            {notice}
          </p>
        )}
        {error && (
          <p className={styles.error} data-testid="error">
            {error}
          </p>
        )}

        {tab === 'documents' && (
          <section className={styles.section}>
            <div className={styles.toolbar}>
              <h2 className={styles.sectionTitle}>Documents</h2>
              <button
                className={styles.btn}
                onClick={() => setUploadOpen(true)}
                data-testid="open-upload"
              >
                <Upload size={16} />
                Upload a document
              </button>
            </div>

            {loading ? (
              <div className={styles.grid} aria-label="Loading…">
                <span className={styles.skeleton} />
                <span className={styles.skeleton} />
                <span className={styles.skeleton} />
              </div>
            ) : documents.length === 0 ? (
              <div className={styles.emptyState}>
                <span className={styles.emptyIcon}>
                  <FileText size={24} />
                </span>
                <p className={styles.emptyTitle}>No documents yet</p>
                <p className={styles.empty} data-testid="documents-empty">
                  No documents yet. Upload a PDF and the people in this
                  agreement can sign it.
                </p>
              </div>
            ) : (
              <div className={styles.grid} data-testid="documents-grid">
                {documents.map((doc) => (
                  <div
                    key={doc.id}
                    className={styles.cardWrap}
                    ref={menuOpenId === doc.id ? menuRef : null}
                    data-testid="document-card"
                  >
                    <button
                      className={styles.card}
                      onClick={() => setViewing(doc)}
                    >
                      <span
                        className={`${styles.cardThumb} ${thumbClass(doc.status)}`}
                        aria-hidden="true"
                      >
                        <span className={styles.paper}>
                          <span className={styles.paperTitle} />
                          <span className={styles.paperLine} />
                          <span className={styles.paperLine} />
                          <span className={styles.paperLineShort} />
                          <span className={styles.paperSign}>
                            {doc.status === 'FullySigned' ? (
                              <PenLine size={12} />
                            ) : null}
                          </span>
                        </span>
                      </span>
                      <span className={styles.cardBody}>
                        <span className={styles.cardName}>{doc.name}</span>
                        <span className={styles.cardStatus}>
                          <span
                            className={`${styles.badge} ${statusClass(doc.status)}`}
                          >
                            {statusIcon(doc.status)}
                            {statusLabel(doc.status)}
                          </span>
                        </span>
                      </span>
                    </button>
                    <button
                      className={`${styles.menuBtn} ${
                        menuOpenId === doc.id ? styles.menuBtnOpen : ''
                      }`}
                      title="More options"
                      aria-label="More options"
                      aria-expanded={menuOpenId === doc.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        setMenuOpenId(menuOpenId === doc.id ? null : doc.id);
                      }}
                    >
                      <MoreHorizontal size={18} />
                    </button>
                    {menuOpenId === doc.id && (
                      <div className={styles.dropdown} role="menu">
                        <button
                          className={styles.dropdownItem}
                          role="menuitem"
                          onClick={() => {
                            setMenuOpenId(null);
                            setViewing(doc);
                          }}
                        >
                          <Eye size={16} />
                          Open
                        </button>
                        {iAmAdmin && (
                          <button
                            className={`${styles.dropdownItem} ${styles.dropdownDanger}`}
                            role="menuitem"
                            onClick={() => void removeDocument(doc)}
                          >
                            <Trash2 size={16} />
                            Delete
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {tab === 'people' && (
          <section className={styles.section}>
            <div className={styles.toolbar}>
              <h2 className={styles.sectionTitle}>People</h2>
            </div>
            {workspaceId && selfAccountId && (
              <div className={styles.createRow}>
                <input
                  className={styles.input}
                  placeholder={
                    nameOf(selfAccountId) ??
                    'Your name — how others in this workspace see you'
                  }
                  aria-label="Your name"
                  value={myName}
                  onChange={(e) => setMyName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && void saveMyName()}
                  data-testid="my-name"
                />
                <button
                  className={styles.btn}
                  onClick={() => void saveMyName()}
                  disabled={savingName || !myName.trim()}
                  data-testid="my-name-save"
                >
                  {nameOf(selfAccountId) ? 'Rename' : 'Set name'}
                </button>
              </div>
            )}
            {roster.length === 0 ? (
              <div className={styles.emptyState}>
                <span className={styles.emptyIcon}>
                  <Users size={24} />
                </span>
                <p className={styles.empty} data-testid="people-empty">
                  {loading ? 'Loading…' : 'Nobody has joined yet.'}
                </p>
              </div>
            ) : (
              <div className={styles.rows} data-testid="people-rows">
                {roster.map((entry) => {
                  const changes = levelChangesFor(entry.level);
                  const busy = roleBusyFor === entry.id;
                  const name = nameOf(entry.id);
                  return (
                    <div
                      className={styles.row}
                      key={entry.id}
                      data-testid="person-row"
                    >
                      <span
                        className={`${styles.avatar} ${
                          entry.level === PermissionLevel.Admin
                            ? styles.avatarAdmin
                            : ''
                        }`}
                      >
                        {participantInitials(entry.id, name)}
                      </span>
                      <span className={styles.rowMain}>
                        {/* The name they set for the workspace, else a short
                            id. The tooltip keeps the full HEX id (not base58:
                            this panel used to render `bs58.encode(user_id)`,
                            an encoding the contract rejects). */}
                        <span className={styles.rowName} title={entry.id}>
                          {personName(entry.id)}
                          {entry.isSelf && (
                            <span className={styles.rowYou}> (you)</span>
                          )}
                        </span>
                        <span className={styles.rowSub}>
                          <span className={styles.roleChip}>{entry.level}</span>
                          {LEVEL_DESCRIPTIONS[entry.level]}
                        </span>
                      </span>
                      {iAmAdmin && (
                        <span className={styles.rowActions}>
                          {changes.map((level) => (
                            <button
                              key={level}
                              className={styles.smallBtn}
                              disabled={busy}
                              onClick={() => void changeLevel(entry.id, level)}
                            >
                              Make {level}
                            </button>
                          ))}
                          {canRemove(roster, entry) && (
                            <button
                              className={`${styles.smallBtn} ${styles.smallBtnDanger}`}
                              disabled={busy}
                              onClick={() => void remove(entry.id)}
                            >
                              Remove
                            </button>
                          )}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {tab === 'invite' && (
          <div className={styles.inviteGrid}>
            <section className={styles.panel}>
              <div className={styles.panelHead}>
                <span className={styles.panelIcon}>
                  <Link2 size={20} />
                </span>
                <div>
                  <h2 className={styles.panelTitle}>Shareable link</h2>
                  <p className={styles.panelText}>
                    Anybody holding this link can join. It expires within a day,
                    and it grants membership of this agreement and nothing else.
                  </p>
                </div>
              </div>
              {inviteLink ? (
                <div className={styles.tokenBox}>
                  <span className={styles.token} data-testid="invite-link">
                    {inviteLink}
                  </span>
                  <button
                    className={styles.copyBtn}
                    onClick={() => copy(inviteLink, 'Invitation link')}
                  >
                    <Copy size={14} />
                    Copy
                  </button>
                </div>
              ) : (
                <div className={styles.buttonRow}>
                  <button
                    className={styles.btn}
                    onClick={() => void mintLink()}
                    disabled={mintingInvite}
                    data-testid="mint-invite"
                  >
                    {mintingInvite ? (
                      <span className={styles.spinner} />
                    ) : (
                      <Link2 size={16} />
                    )}
                    {mintingInvite ? 'Creating…' : 'Create invitation link'}
                  </button>
                </div>
              )}
            </section>

            <section className={styles.panel}>
              <div className={styles.panelHead}>
                <span className={styles.panelIcon}>
                  <UserPlus size={20} />
                </span>
                <div>
                  <h2 className={styles.panelTitle}>Invite one person</h2>
                  <p className={styles.panelText}>
                    For a specific Calimero identity. They send you their id;
                    this mints a link only they can redeem.
                  </p>
                </div>
              </div>
              <div className={styles.createRow}>
                <input
                  className={styles.input}
                  placeholder="Their id (64 hex characters)…"
                  aria-label="Their id"
                  value={inviteeId}
                  onChange={(e) => setInviteeId(e.target.value)}
                  data-testid="invitee-id"
                />
                <select
                  className={`${styles.input} ${styles.select}`}
                  value={inviteeLevel}
                  onChange={(e) =>
                    setInviteeLevel(e.target.value as PermissionLevel)
                  }
                  data-testid="invitee-level"
                  aria-label="What they can do"
                >
                  {INVITABLE_LEVELS.map((level) => (
                    <option key={level} value={level}>
                      {INVITE_LEVEL_LABELS[level]}
                    </option>
                  ))}
                </select>
                <button
                  className={styles.btn}
                  onClick={() => void mintTargeted()}
                  disabled={mintingInvite || !inviteeId.trim()}
                >
                  Create
                </button>
              </div>
              <p className={styles.note}>
                A document is complete once every signer has signed it; viewers
                are never waited on. A viewer can be made a signer later, but a
                signer cannot be made a viewer — to undo that you have to remove
                them and invite them again.
              </p>
              {targetedLink && (
                <div className={styles.tokenBox}>
                  <span className={styles.token}>{targetedLink}</span>
                  <button
                    className={styles.copyBtn}
                    onClick={() => copy(targetedLink, 'Invitation link')}
                  >
                    <Copy size={14} />
                    Copy
                  </button>
                </div>
              )}
            </section>
          </div>
        )}
      </main>

      {uploadOpen && (
        <div
          className={styles.modalBackdrop}
          onClick={() => setUploadOpen(false)}
        >
          <div
            className={styles.modal}
            role="dialog"
            aria-modal="true"
            aria-labelledby="upload-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className={styles.modalTitle} id="upload-title">
              Upload a document
            </h2>
            <p className={styles.modalDesc}>
              A PDF. Everyone in this agreement will be able to read it and sign
              it; it is stored on the nodes of the people invited here.
            </p>
            <label
              className={`${styles.drop} ${uploadFile ? styles.dropPicked : ''}`}
            >
              <span className={styles.dropIcon}>
                {uploadFile ? (
                  <FileText size={22} />
                ) : (
                  <UploadCloud size={22} />
                )}
              </span>
              <span className={styles.dropName}>
                {uploadFile ? uploadFile.name : 'Choose a PDF…'}
              </span>
              <span className={styles.dropHint}>
                {uploadFile ? 'Click to choose another' : 'PDF files only'}
              </span>
              <input
                className={styles.dropInput}
                type="file"
                accept="application/pdf"
                onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)}
                data-testid="upload-input"
              />
            </label>
            <div className={styles.modalRow}>
              <button
                className={styles.btnGhost}
                onClick={() => setUploadOpen(false)}
              >
                Cancel
              </button>
              <button
                className={styles.btn}
                onClick={() => void upload()}
                disabled={!uploadFile || uploading}
              >
                {uploading ? <span className={styles.spinner} /> : null}
                {uploading ? 'Uploading…' : 'Upload'}
              </button>
            </div>
          </div>
        </div>
      )}

      {viewing && (
        <div
          className={styles.viewerScrim}
          onClick={() => setViewing(null)}
          data-testid="document-backdrop"
        >
          <div
            className={styles.viewerPanel}
            role="dialog"
            aria-modal="true"
            aria-label={viewing.name}
            // Clicks inside the panel are not a click on the backdrop.
            onClick={(e) => e.stopPropagation()}
          >
            {/* ⚠️ THE VIEWER IS NOT MOUNTED UNTIL THERE ARE BYTES.
                `PDFViewer` renders "No PDF selected. Please upload a PDF to
                get started." for a null `file` — the exact copy this change
                exists to stop showing. Mounting it while the blob is still
                downloading flashes that message on every open, and mounting
                it after a failure leaves it sitting under the real error,
                contradicting it. So: fetching says fetching, a failure says
                what failed, and the viewer appears when it has something to
                view. */}
            {viewingError ? (
              <div className={styles.viewerState}>
                <p className={styles.error} data-testid="document-error">
                  {viewingError}
                </p>
                <button
                  className={styles.btnGhost}
                  onClick={() => setViewing(null)}
                >
                  Close
                </button>
              </div>
            ) : !viewingFile ? (
              <div className={styles.viewerState}>
                <span className={styles.spinnerLarge} />
                <p className={styles.empty} data-testid="document-loading">
                  Loading {viewing.name}…
                </p>
              </div>
            ) : (
              <>
                {integrity && (
                  <p
                    className={`${styles.error} ${styles.integrity}`}
                    data-testid="integrity-warning"
                  >
                    {integrity}
                  </p>
                )}
                <PDFViewer
                  file={viewingFile}
                  onClose={() => setViewing(null)}
                  title={viewing.name}
                  showDownload
                  showClose
                  maxHeight="100%"
                  contextId={contextId}
                  documentId={viewing.id}
                  documentHash={viewing.hash}
                  showSaveToContext
                  onDocumentSaved={() => {
                    setViewing(null);
                    void loadDocuments();
                  }}
                />
              </>
            )}
          </div>
        </div>
      )}

      {!contextId && (
        <main className={styles.main}>
          <p className={styles.empty}>
            No agreement selected.{' '}
            <button
              className={styles.btnGhost}
              onClick={() => navigate('/agreements')}
            >
              Back to your agreements
            </button>
          </p>
        </main>
      )}
    </AppShell>
  );
}
