import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { v4 as uuid } from "uuid";
import { rpcCall, adminGet, adminUploadBlob, adminGetBlob, joinContext } from "../api/rpc";
import { useSse } from "../hooks/useSse";
import { useMero } from "@calimero-network/mero-react";
import { useCanvasStore } from "../store/canvasStore";
import { useUsernameStore } from "../store/usernameStore";
import type { CanvasComment, CursorState, Element, Member } from "../types";
import Toolbar from "../components/Toolbar";
import FabricCanvas, { type FabricCanvasHandle } from "../components/FabricCanvas";
import PropertiesPanel from "../components/PropertiesPanel";
import CommentsOverlay from "../components/CommentsOverlay";
import CursorsOverlay from "../components/CursorsOverlay";
import UsernameModal from "../components/UsernameModal";
import { exportProject, importProject, type ProjectSnapshot } from "../utils/projectFile";
import { extractErrorMessage } from "../utils/errorMessage";
import styles from "./CanvasPage.module.css";

function normalizeCursor(c: CursorState): CursorState {
  return { ...c, updatedAt: c.updatedAt ?? c.updated_at ?? 0 };
}

export default function CanvasPage() {
  const { teamId, projectId } = useParams<{ teamId: string; projectId: string }>();
  const navigate = useNavigate();
  const { logout } = useMero();
  const { setElements, upsertElement, removeElement, cacheImage, elements, imageCache, previewMode, setPreviewMode } = useCanvasStore();
  const { getUsername, setUsername } = useUsernameStore();

  const canvasRef = useRef<FabricCanvasHandle>(null);

  // Collaboration state
  const [comments, setComments] = useState<CanvasComment[]>([]);
  const [cursors, setCursors] = useState<CursorState[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [showUsernameModal, setShowUsernameModal] = useState(false);
  const [addingComment, setAddingComment] = useState(false);
  const [myIdentity, setMyIdentity] = useState("");
  // Effective canvas permission for this identity (admin/editor → true, viewer → false).
  // The contract enforces this at merge; this flag is for read-only UX.
  const [canEdit, setCanEdit] = useState(true);
  const [viewport, setViewport] = useState({ zoom: 1, panX: 0, panY: 0 });
  const cursorThrottleRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // "loading" = first attempt; "syncing" = context not yet available on this node, retrying
  const [syncStatus, setSyncStatus] = useState<"loading" | "syncing" | "ready">("loading");
  const [syncError, setSyncError] = useState<string | null>(null);
  const [syncTrigger, setSyncTrigger] = useState(0);
  const syncRetryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const syncRetryCountRef = useRef(0);
  const joinAttemptedRef = useRef(false);

  // Fetch real context identity from the node (the key WASM knows as member_id).
  // Persists the last known identity in localStorage so refresh doesn't produce a
  // new random UUID when the API is temporarily unavailable. Re-run after we join
  // a context (the node only returns our key once we're a member).
  // `shouldApply` guards setMyIdentity so a slow response from a previous project
  // can't clobber the identity after the user has switched canvases. Callers pass
  // their own !cancelled check; the localStorage write is per-project (keyed by id)
  // so it's safe to run regardless of which canvas is now active.
  const refreshIdentity = useCallback((shouldApply: () => boolean = () => true) => {
    if (!projectId) return;
    const storageKey = `md-identity-${projectId}`;
    adminGet<unknown>(`/contexts/${projectId}/identities-owned`)
      .then((res) => {
        const arr: string[] = Array.isArray(res)
          ? (res as string[])
          : ((res as { identities?: string[]; items?: string[] })?.identities
              ?? (res as { identities?: string[]; items?: string[] })?.items
              ?? []);
        if (arr.length > 0) {
          localStorage.setItem(storageKey, arr[0]);
          if (shouldApply()) setMyIdentity(arr[0]);
        }
      })
      .catch(() => {
        // identities-owned 404s when this node hasn't joined the context yet
        // (e.g. a project created on a peer). Fall back to the cached key for THIS
        // project — the member id is per-context, so never keep the previous
        // canvas's identity (`cur`). Last resort: a fresh uuid, cached under this
        // project's key so it stays stable across retries instead of churning, and
        // is replaced by the real key once we join.
        const stored = localStorage.getItem(storageKey);
        if (stored) {
          if (shouldApply()) setMyIdentity(stored);
        } else {
          const generated = uuid();
          localStorage.setItem(storageKey, generated);
          if (shouldApply()) setMyIdentity(generated);
        }
      });
  }, [projectId]);

  useEffect(() => {
    let cancelled = false;
    refreshIdentity(() => !cancelled);
    return () => { cancelled = true; };
  }, [refreshIdentity]);

  function handleBack() { navigate(`/teams/${teamId}/projects`); }
  function handleLogout() { logout(); navigate("/login"); }

  // ESC exits preview / comment mode (not username modal — that's blocking)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !showUsernameModal) {
        setPreviewMode(false);
        setAddingComment(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setPreviewMode, showUsernameModal]);

  // Load initial data. Retries every 3 s if the context isn't available yet on
  // this node (e.g. the project was created on a peer and sync is in progress).
  useEffect(() => {
    if (!projectId) return;
    if (syncRetryRef.current) clearTimeout(syncRetryRef.current);
    setSyncStatus("loading");
    setSyncError(null);
    // Clear the previous project's state so nothing leaks across a switch: stale
    // elements would otherwise be blob-fetched against the new context id, the old
    // member id (per-context) must not linger until refreshIdentity resolves, and
    // stale members would let CursorsOverlay label this project's cursors with the
    // previous project's usernames until the new get_members resolves.
    setElements([]);
    setComments([]);
    setCursors([]);
    setMembers([]);
    setMyIdentity("");
    syncRetryCountRef.current = 0;
    joinAttemptedRef.current = false;
    // Guard all async work against project navigation: a slow joinContext / identity
    // refresh from a previous project must not mutate state, join the wrong context,
    // or schedule a retry for a canvas the user has already left.
    let cancelled = false;

    function tryLoad() {
      if (cancelled) return;
      rpcCall<Element[]>(projectId!, "get_elements", {})
        .then((els) => {
          if (cancelled) return;
          setElements(Array.isArray(els) ? els : []);
          setSyncStatus("ready");
          setSyncError(null);
          rpcCall<CanvasComment[]>(projectId!, "get_comments", {})
            .then((cs) => { if (!cancelled) setComments(Array.isArray(cs) ? cs : []); })
            .catch(() => {});
          rpcCall<CursorState[]>(projectId!, "get_cursors", {})
            .then((cs) => { if (!cancelled) setCursors(Array.isArray(cs) ? cs.map(normalizeCursor) : []); })
            .catch(() => {});
        })
        .catch(async (err) => {
          if (cancelled) return;
          const msg: string = err?.message ?? String(err);
          // First failure → this node likely hasn't joined the context yet (it was
          // created on a peer; we're only entitled via the team). The node reports
          // this as "No owned identity found for this context" or "Context not found".
          // Join once (idempotent — returns our existing key if already a member),
          // then sync proceeds normally. Done unconditionally on the first failure
          // rather than string-matching the error, which varies by node version.
          if (!joinAttemptedRef.current) {
            joinAttemptedRef.current = true;
            console.warn(`[MeroDesign] get_elements failed ("${msg}") — joining context…`);
            setSyncStatus("syncing");
            try {
              await joinContext(projectId!);
              if (cancelled) return;
              refreshIdentity(() => !cancelled); // now a member — fetch our real context key
            } catch (joinErr) {
              if (cancelled) return;
              // joinContext uses adminPost → rejects with a raw Axios error, so pull
              // the node's `{ error }` body (where entitlement rejections live) rather
              // than the generic HTTP message.
              const jmsg = extractErrorMessage(joinErr, "join failed");
              console.error("[MeroDesign] auto-join failed:", jmsg);
              // Surface it — otherwise the canvas shows an endless "syncing" hint and
              // the user never learns the join was rejected (e.g. not entitled).
              setSyncError(`Couldn't join this project: ${jmsg}`);
            }
            if (!cancelled) syncRetryRef.current = setTimeout(tryLoad, 1500);
            return;
          }
          syncRetryCountRef.current += 1;
          console.error(`[MeroDesign] get_elements failed (attempt ${syncRetryCountRef.current}):`, msg);
          // After ~30s of retries surface the actual error so the user knows what's wrong
          if (syncRetryCountRef.current >= 10) setSyncError(msg);
          setSyncStatus("syncing");
          syncRetryRef.current = setTimeout(tryLoad, 3000);
        });
    }

    tryLoad();
    return () => {
      cancelled = true;
      if (syncRetryRef.current) clearTimeout(syncRetryRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, syncTrigger]);

  // Auto-fetch blobs for image elements that aren't in the local cache yet.
  // Fires whenever elements change (initial load, SSE updates, etc.).
  // fetchingRef prevents duplicate in-flight requests for the same element.
  const fetchingBlobsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const el of elements) {
      const blobId = (el.data as { blobId?: string }).blobId;
      if ((el.data.kind === "image" || el.data.kind === "svg") && blobId && !imageCache[el.id] && !fetchingBlobsRef.current.has(el.id)) {
        fetchingBlobsRef.current.add(el.id);
        const kind = el.data.kind;
        const elId = el.id;
        // Pass projectId (the context id) so the node can P2P-fetch blobs that
        // were uploaded on a peer node — without it the receiver only checks
        // local storage and 404s. See adminGetBlob.
        adminGetBlob(blobId, projectId)
          .then((buf) => {
            const mime = kind === "svg" ? "image/svg+xml" : "image/png";
            const url = URL.createObjectURL(new Blob([buf], { type: mime }));
            cacheImage(elId, url);
          })
          .catch((err) => {
            console.error("[MeroDesign] blob fetch failed for element", elId, err);
            fetchingBlobsRef.current.delete(elId);
          });
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elements]);

  // Check WASM members — WASM is the source of truth for username existence.
  // Show modal if this identity has no username registered in the contract.
  // usernameStore is only used to pre-fill the modal input.
  useEffect(() => {
    if (!projectId || !myIdentity) return;
    // Guard against a slow get_members from the previous project repopulating the
    // roster (and mislabeling cursors) after the user switched canvases.
    let cancelled = false;
    rpcCall<Member[]>(projectId, "get_members", {})
      .then((ms) => {
        if (cancelled) return;
        const list = Array.isArray(ms) ? ms : [];
        setMembers(list);
        const member = list.find((m) => m.id === myIdentity);
        const hasUsername = member?.username && member.username.trim().length > 0;
        if (!hasUsername) {
          setShowUsernameModal(true);
        }
      })
      .catch(() => {
        if (cancelled) return;
        // Can't verify — show modal to be safe
        setShowUsernameModal(true);
      });
    return () => { cancelled = true; };
  }, [projectId, myIdentity]);

  async function handleUsernameSubmit(username: string) {
    if (!projectId || !myIdentity) return;
    // Register in WASM — this is the authoritative store. The member id is
    // derived server-side from the real signer (env::executor_id); we no longer
    // pass a spoofable member_id.
    await rpcCall(projectId, "join", {
      username,
      avatar: null,
      timestamp: Date.now(),
    }).catch(() => {});
    // Cache locally for convenience (pre-fill on future sessions)
    setUsername(myIdentity, username);
    setShowUsernameModal(false);
    rpcCall<Member[]>(projectId, "get_members", {})
      .then((ms) => setMembers(Array.isArray(ms) ? ms : []))
      .catch(() => {});
  }

  // Resolve this identity's canvas permission. Viewers (no editor/admin role)
  // get a read-only canvas. Re-checked when the roster changes (e.g. an admin
  // just granted us editor). Defaults to editable so a transient RPC failure
  // never silently locks an editor out.
  useEffect(() => {
    if (!projectId || !myIdentity) return;
    let cancelled = false;
    rpcCall<boolean>(projectId, "can_edit", {})
      .then((res) => { if (!cancelled) setCanEdit(res !== false); })
      .catch(() => { if (!cancelled) setCanEdit(true); });
    return () => { cancelled = true; };
  }, [projectId, myIdentity, members]);

  // Poll cursors every 5 s so other members appear even without SSE
  useEffect(() => {
    if (!projectId) return;
    // Guard against an in-flight poll response from the previous project landing
    // after a switch and repopulating cursors (mislabeled via stale members) on the
    // new canvas.
    let cancelled = false;
    const id = setInterval(() => {
      rpcCall<CursorState[]>(projectId, "get_cursors", {})
        .then((cs) => { if (!cancelled) setCursors(Array.isArray(cs) ? cs.map(normalizeCursor) : []); })
        .catch(() => {});
    }, 5000);
    return () => { cancelled = true; clearInterval(id); };
  }, [projectId]);

  // Cursor broadcast (throttled to 2-3s)
  const broadcastCursor = useCallback((x: number, y: number) => {
    if (!projectId || !myIdentity) return;
    if (cursorThrottleRef.current) return;
    cursorThrottleRef.current = setTimeout(() => {
      cursorThrottleRef.current = null;
      const now = Date.now();
      setCursors((prev) => {
        const idx = prev.findIndex((c) => c.identity === myIdentity);
        const updated = { identity: myIdentity, x, y, updatedAt: now };
        if (idx >= 0) { const n = [...prev]; n[idx] = updated; return n; }
        return [...prev, updated];
      });
      // identity is derived server-side from the signer; not client-supplied.
      rpcCall(projectId, "update_cursor", { x, y, updated_at: now }).catch(() => {});
    }, 2500);
  }, [projectId, myIdentity]);

  function handleCanvasMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    broadcastCursor(Math.round(e.clientX), Math.round(e.clientY));
  }

  // SSE handler — the node sends StateMutation payloads:
  // { newRoot: "...", events: [{ kind: "ElementAdded", data: u8[], handler: null }] }
  // Each event's data bytes are the WASM-emitted content (JSON-encoded value).
  const handleSseEvent = useCallback(
    (raw: unknown) => {
      try {
        if (!projectId || typeof raw !== "object" || raw === null) return;
        const payload = raw as { events?: Array<{ kind: string; data: number[] }> };
        const events = Array.isArray(payload.events) ? payload.events : [];

        for (const ev of events) {
          const kind = ev.kind ?? "";
          let value: unknown = null;
          if (Array.isArray(ev.data) && ev.data.length > 0) {
            try {
              const text = new TextDecoder().decode(new Uint8Array(ev.data));
              value = JSON.parse(text);
            } catch { /* keep null */ }
          }

          if (kind === "ElementAdded" || kind === "ElementUpdated") {
            rpcCall<Element>(projectId, "get_element", { id: value as string })
              .then((el) => { if (el) upsertElement(el); })
              .catch(() => {});
          } else if (kind === "ElementDeleted") {
            removeElement(value as string);
          } else if (kind === "LayerReordered") {
            rpcCall<Element[]>(projectId, "get_elements", {})
              .then((els) => setElements(Array.isArray(els) ? els : []))
              .catch(() => {});
          } else if (kind === "CommentAdded" || kind === "CommentUpdated") {
            rpcCall<CanvasComment[]>(projectId, "get_comments", {})
              .then((cs) => setComments(Array.isArray(cs) ? cs : []))
              .catch(() => {});
          } else if (kind === "CommentDeleted") {
            setComments((prev) => prev.filter((c) => c.id !== (value as string)));
          } else if (kind === "CursorMoved") {
            rpcCall<CursorState[]>(projectId, "get_cursors", {})
              .then((cs) => setCursors(Array.isArray(cs) ? cs.map(normalizeCursor) : []))
              .catch(() => {});
          } else if (kind === "MemberJoined" || kind === "MemberUsernameUpdated") {
            rpcCall<Member[]>(projectId, "get_members", {})
              .then((ms) => setMembers(Array.isArray(ms) ? ms : []))
              .catch(() => {});
          } else if (kind === "RoleUpdated" || kind === "OwnerTransferred") {
            // A grant/revoke/transfer may flip our own edit permission — re-resolve
            // it immediately instead of waiting for a reload, and refresh the roster.
            rpcCall<boolean>(projectId, "can_edit", {})
              .then((res) => setCanEdit(res !== false))
              .catch(() => {});
            rpcCall<Member[]>(projectId, "get_members", {})
              .then((ms) => setMembers(Array.isArray(ms) ? ms : []))
              .catch(() => {});
          }
        }
      } catch {
        // ignore parse errors
      }
    },
    [projectId, upsertElement, removeElement, setElements],
  );

  useSse(projectId ?? null, handleSseEvent);

  async function handleSaveProject() {
    if (!projectId) return;
    await exportProject(projectId).catch(() => {});
  }

  async function handleImportProject(snapshot: ProjectSnapshot) {
    if (!projectId) return;
    await importProject(projectId, snapshot).catch(() => {});
    rpcCall<Element[]>(projectId, "get_elements", {})
      .then((els) => setElements(Array.isArray(els) ? els : []))
      .catch(() => {});
    rpcCall<CanvasComment[]>(projectId, "get_comments", {})
      .then((cs) => setComments(Array.isArray(cs) ? cs : []))
      .catch(() => {});
  }

  async function handleImageUpload(
    file: File, dataUrl: string, naturalWidth: number, naturalHeight: number,
  ) {
    if (!projectId) return;
    const maxW = 400;
    const scale = naturalWidth > maxW ? maxW / naturalWidth : 1;
    const id = uuid();

    // Upload blob to node so it propagates across the context
    let blobId = "";
    try {
      const buf = await file.arrayBuffer();
      const result = await adminUploadBlob(buf, projectId);
      blobId = result?.blobId ?? "";
    } catch (err) {
      console.error("[MeroDesign] blob upload failed — image will only be visible this session:", err);
    }

    const el: Element = {
      id,
      data: { kind: "image", naturalWidth, naturalHeight, blobId },
      x: 40, y: 40,
      width: Math.round(naturalWidth * scale), height: Math.round(naturalHeight * scale),
      rotation: 0, fill: "transparent", stroke: "transparent", strokeWidth: 0, opacity: 100,
      layerIndex: elements.length,
      createdBy: myIdentity, createdAt: Date.now(), updatedAt: Date.now(),
    };
    cacheImage(id, dataUrl);
    upsertElement(el);
    await rpcCall(projectId, "add_element", { element: el }).catch(() => {});
  }

  if (syncStatus !== "ready") {
    return (
      <div className={styles.root}>
        <div className={styles.syncScreen}>
          <div className={styles.syncSpinner} />
          <p className={styles.syncTitle}>
            {syncStatus === "loading" ? "Loading project…" : "Syncing with network…"}
          </p>
          {syncStatus === "syncing" && !syncError && (
            <p className={styles.syncHint}>
              This project was created on another node. Waiting for context sync to complete.
            </p>
          )}
          {syncError && (
            <p className={styles.syncError}>
              {syncError}
            </p>
          )}
          {syncStatus === "syncing" && (
            <button
              className={styles.syncRetry}
              onClick={() => setSyncTrigger((n) => n + 1)}
            >
              Retry now
            </button>
          )}
          <button className={styles.syncBack} onClick={handleBack}>← Back to projects</button>
        </div>
      </div>
    );
  }

  if (previewMode) {
    return (
      <div className={styles.previewOverlay}>
        <span className={styles.previewHint} onClick={() => setPreviewMode(false)}>
          ESC to exit preview ✕
        </span>
        <FabricCanvas ref={canvasRef} contextId={projectId ?? ""} previewMode />
      </div>
    );
  }

  return (
    <div className={styles.root}>
      {showUsernameModal && (
        <UsernameModal
          onSubmit={handleUsernameSubmit}
          initialValue={getUsername(myIdentity)}
        />
      )}
      <Toolbar
        contextId={projectId ?? ""}
        onBack={handleBack}
        onLogout={handleLogout}
        onExportPng={() => canvasRef.current?.exportPng()}
        onExportSvg={() => canvasRef.current?.exportSvg()}
        onPreview={() => setPreviewMode(true)}
        onImageUpload={handleImageUpload}
        addingComment={addingComment}
        onToggleComment={() => setAddingComment((v) => !v)}
        members={cursors.filter((c) => c.identity !== myIdentity && Date.now() - c.updatedAt < 30_000)}
        onSaveProject={handleSaveProject}
        onImportProject={handleImportProject}
        readOnly={!canEdit}
      />
      <div className={styles.workspace}>
        <div className={styles.canvasWrap} onMouseMove={handleCanvasMouseMove}>
          <FabricCanvas
            ref={canvasRef}
            contextId={projectId ?? ""}
            addingComment={addingComment}
            readOnly={!canEdit}
            onViewportChange={(z, px, py) => setViewport({ zoom: z, panX: px, panY: py })}
          />
          <CursorsOverlay cursors={cursors} myIdentity={myIdentity} members={members} viewport={viewport} />
          <CommentsOverlay
            contextId={projectId ?? ""}
            comments={comments}
            myIdentity={myIdentity}
            addingComment={addingComment}
            viewport={viewport}
            onCommentAdded={(c) => setComments((prev) => [...prev, c])}
            onCommentDeleted={(id) => setComments((prev) => prev.filter((c) => c.id !== id))}
            onReplyAdded={(cid, r) => setComments((prev) =>
              prev.map((c) => c.id === cid ? { ...c, replies: [...c.replies, r] } : c)
            )}
            onReplyDeleted={(cid, rid) => setComments((prev) =>
              prev.map((c) => c.id === cid ? { ...c, replies: c.replies.filter((r) => r.id !== rid) } : c)
            )}
            onCancelAdd={() => setAddingComment(false)}
            readOnly={!canEdit}
          />
        </div>
        <PropertiesPanel contextId={projectId ?? ""} readOnly={!canEdit} />
      </div>
    </div>
  );
}
