import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  apiClient,
  getContextId,
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
import { encodeInvite } from '../../lib/inviteCodec';
import { shareableInvitation } from '../../lib/inviteLink';
import {
  DEMOTION_UNAVAILABLE,
  LEVEL_DESCRIPTIONS,
  buildRoster,
  canRemove,
  isAdmin,
  isHexId,
  promotionsFor,
  shortId,
  toHexId,
} from '../../lib/participants';
import { AppHeader } from '../../components/AppHeader';
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

const TABS: { id: Tab; label: string }[] = [
  { id: 'documents', label: 'Documents' },
  { id: 'people', label: 'People' },
  { id: 'invite', label: 'Invite' },
];

function statusClass(status: string): string {
  if (status === 'FullySigned') return styles.badgeSigned;
  if (status === 'PartiallySigned') return styles.badgePartial;
  return styles.badgePending;
}

/** The card's thumbnail tint, so three documents do not read as three identical
 *  grey rectangles. Green only for the completed one, as a fill. */
function thumbClass(status: string): string {
  if (status === 'FullySigned') return styles.thumbSigned;
  return styles.thumbPartial;
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
  const [viewingError, setViewingError] = useState<string | null>(null);

  // Fetch the bytes whenever a document is opened, and drop them when it is
  // closed so a second open cannot show the first one's pages.
  useEffect(() => {
    if (!viewing) {
      setViewingFile(null);
      setViewingError(null);
      return;
    }
    let cancelled = false;
    setViewingFile(null);
    setViewingError(null);
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
        const blob = await blobClient.downloadBlob(blobId, contextId);
        if (cancelled) return;
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

  const [invite, setInvite] = useState<{
    link: string;
    deepLink: string;
    code: string;
  } | null>(null);
  const [mintingInvite, setMintingInvite] = useState(false);
  // ⚠️ An invitation is to the WORKSPACE, not to this agreement. See below.
  const workspaceId = useActiveWorkspace();
  const [inviteeId, setInviteeId] = useState('');
  const [targetedPayload, setTargetedPayload] = useState('');

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

  const promote = useCallback(
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
        flash(`${shortId(userId)} is now ${level}.`);
        await loadDetails();
      } finally {
        setRoleBusyFor(null);
      }
    },
    [clientApi, contextId, executorKey, flash, loadDetails],
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
        flash(`${shortId(userId)} removed.`);
        await loadDetails();
      } finally {
        setRoleBusyFor(null);
      }
    },
    [clientApi, contextId, executorKey, flash, loadDetails],
  );

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
      setInvite(shareableInvitation(code));
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
      await clientApi.addParticipant(
        contextId,
        id,
        PermissionLevel.Sign,
        contextId,
        executorKey || undefined,
      );
      setTargetedPayload(res.data);
    } finally {
      setMintingInvite(false);
    }
  }, [inviteeId, nodeApi, clientApi, contextId, executorKey]);

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
    <div className={styles.root}>
      <AppHeader back={{ label: 'Agreements', to: '/agreements' }} />

      <main className={styles.main}>
        <h1 className={styles.title} data-testid="agreement-title">
          {name}
        </h1>
        <p className={styles.subtitle}>
          {details
            ? `${details.participant_count} ${
                details.participant_count === 1 ? 'person' : 'people'
              } · ${documents.length} ${
                documents.length === 1 ? 'document' : 'documents'
              }`
            : 'Loading…'}
        </p>

        <div className={styles.tabs}>
          {TABS.map((t) => (
            <button
              key={t.id}
              className={`${styles.tab} ${tab === t.id ? styles.tabActive : ''}`}
              onClick={() => setTab(t.id)}
              data-testid={`tab-${t.id}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {notice && (
          <p className={styles.notice} data-testid="notice">
            {notice}
          </p>
        )}
        {error && (
          <p className={styles.error} data-testid="error">
            {error}
          </p>
        )}

        {tab === 'documents' && (
          <>
            <div className={styles.createRow}>
              <button
                className={styles.btn}
                onClick={() => setUploadOpen(true)}
                data-testid="open-upload"
              >
                Upload a document
              </button>
            </div>

            {loading ? (
              <p className={styles.empty}>Loading…</p>
            ) : documents.length === 0 ? (
              <p className={styles.empty} data-testid="documents-empty">
                No documents yet. Upload a PDF and the people in this agreement
                can sign it.
              </p>
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
                      />
                      <span className={styles.cardName}>{doc.name}</span>
                      <span className={styles.cardStatus}>
                        <span className={statusClass(doc.status)}>
                          {statusLabel(doc.status)}
                        </span>
                      </span>
                    </button>
                    <button
                      className={styles.menuBtn}
                      title="More options"
                      onClick={(e) => {
                        e.stopPropagation();
                        setMenuOpenId(menuOpenId === doc.id ? null : doc.id);
                      }}
                    >
                      ⋯
                    </button>
                    {menuOpenId === doc.id && (
                      <div className={styles.dropdown}>
                        <button
                          className={styles.dropdownItem}
                          onClick={() => {
                            setMenuOpenId(null);
                            setViewing(doc);
                          }}
                        >
                          Open
                        </button>
                        {iAmAdmin && (
                          <button
                            className={`${styles.dropdownItem} ${styles.dropdownDanger}`}
                            onClick={() => void removeDocument(doc)}
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {tab === 'people' && (
          <>
            {roster.length === 0 ? (
              <p className={styles.empty} data-testid="people-empty">
                {loading ? 'Loading…' : 'Nobody has joined yet.'}
              </p>
            ) : (
              <div className={styles.rows} data-testid="people-rows">
                {roster.map((entry) => {
                  const promotions = promotionsFor(entry.level);
                  const busy = roleBusyFor === entry.id;
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
                        {entry.id.slice(0, 2).toUpperCase()}
                      </span>
                      <span className={styles.rowMain}>
                        {/* HEX, not base58. This panel used to render
                            `bs58.encode(user_id)`, so every id on screen was in
                            an encoding the contract rejects. */}
                        <span className={styles.rowName}>
                          {shortId(entry.id)}
                          {entry.isSelf && (
                            <span className={styles.rowYou}> (you)</span>
                          )}
                        </span>
                        <span className={styles.rowSub}>
                          {entry.level} — {LEVEL_DESCRIPTIONS[entry.level]}
                        </span>
                      </span>
                      {iAmAdmin && (
                        <span className={styles.rowActions}>
                          {promotions.map((level) => (
                            <button
                              key={level}
                              className={styles.smallBtn}
                              disabled={busy}
                              onClick={() => void promote(entry.id, level)}
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
            {iAmAdmin && roster.length > 0 && (
              <p className={styles.note}>{DEMOTION_UNAVAILABLE}</p>
            )}
          </>
        )}

        {tab === 'invite' && (
          <div style={{ maxWidth: 520 }}>
            <div className={styles.sectionRow}>
              <span className={styles.sectionTitle}>Shareable link</span>
            </div>
            <p className={styles.subtitle} style={{ marginBottom: 16 }}>
              Anybody holding this link can join. It expires within a day, and
              it grants membership of this agreement and nothing else.
            </p>
            {invite ? (
              <>
                <div className={styles.tokenBox}>
                  <span className={styles.token} data-testid="invite-link">
                    {invite.link}
                  </span>
                  <button
                    className={styles.copyBtn}
                    onClick={() => copy(invite.link, 'Invitation link')}
                  >
                    Copy
                  </button>
                </div>
                <div
                  className={styles.modalRow}
                  style={{ justifyContent: 'flex-start' }}
                >
                  <button
                    className={styles.btnGhost}
                    onClick={() => copy(invite.deepLink, 'Desktop link')}
                  >
                    Copy desktop link
                  </button>
                  <button
                    className={styles.btnGhost}
                    onClick={() => copy(invite.code, 'Invitation code')}
                  >
                    Copy code
                  </button>
                </div>
              </>
            ) : (
              <button
                className={styles.btn}
                onClick={() => void mintLink()}
                disabled={mintingInvite}
                data-testid="mint-invite"
              >
                {mintingInvite ? <span className={styles.spinner} /> : null}
                {mintingInvite ? 'Creating…' : 'Create invitation link'}
              </button>
            )}

            <div className={styles.section}>
              <div className={styles.sectionRow}>
                <span className={styles.sectionTitle}>Invite one person</span>
              </div>
              <p className={styles.subtitle} style={{ marginBottom: 12 }}>
                For a specific Calimero identity. They send you their id; this
                mints a payload only they can redeem.
              </p>
              <div className={styles.createRow}>
                <input
                  className={styles.input}
                  placeholder="Their id (64 hex characters)…"
                  value={inviteeId}
                  onChange={(e) => setInviteeId(e.target.value)}
                  data-testid="invitee-id"
                />
                <button
                  className={styles.btn}
                  onClick={() => void mintTargeted()}
                  disabled={mintingInvite || !inviteeId.trim()}
                >
                  Create
                </button>
              </div>
              {targetedPayload && (
                <div className={styles.tokenBox}>
                  <span className={styles.token}>{targetedPayload}</span>
                  <button
                    className={styles.copyBtn}
                    onClick={() => copy(targetedPayload, 'Invitation payload')}
                  >
                    Copy
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      {uploadOpen && (
        <div
          className={styles.modalBackdrop}
          onClick={() => setUploadOpen(false)}
        >
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <h2 className={styles.modalTitle}>Upload a document</h2>
            <p className={styles.modalDesc}>
              A PDF. Everyone in this agreement will be able to read it and sign
              it; it is stored on the nodes of the people invited here.
            </p>
            <label
              className={`${styles.drop} ${uploadFile ? styles.dropPicked : ''}`}
            >
              {uploadFile ? uploadFile.name : 'Choose a PDF…'}
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
        <div className={styles.modalBackdrop}>
          <div
            className={styles.modal}
            style={{ maxWidth: 980, padding: 0, maxHeight: '92vh' }}
          >
            {viewingError && (
              <p
                className={styles.error}
                style={{ margin: 16 }}
                data-testid="document-error"
              >
                {viewingError}
              </p>
            )}
            <PDFViewer
              file={viewingFile}
              onClose={() => setViewing(null)}
              title={viewing.name}
              showDownload
              showClose
              maxHeight="86vh"
              contextId={contextId}
              documentId={viewing.id}
              documentHash={viewing.hash}
              showSaveToContext
              onDocumentSaved={() => {
                setViewing(null);
                void loadDocuments();
              }}
            />
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
    </div>
  );
}
