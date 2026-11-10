import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { v4 as uuid } from "uuid";
import { rpcCall, getBlob, getNodeIdentity, uploadBlob } from "../api/rpc";
import { useSse } from "../hooks/useSse";
import { getElementsByIds } from "../api/elementBatch";
import { collectBoardChanges } from "../utils/boardEvents";
import { useGroupActions } from "../hooks/useGroupActions";
import { useMemberNames, useMyName } from "../api/names";
import { decideBoardName, legacyUsername } from "../utils/boardName";
import { countRender } from "../utils/renderCount";
import { useShallow } from "zustand/react/shallow";
import { useCanvasStore } from "../store/canvasStore";
import type { CanvasComment, CursorState, Element, Member } from "../types";
import Toolbar from "../components/Toolbar";
import FabricCanvas, { type FabricCanvasHandle } from "../components/FabricCanvas";
import PropertiesPanel from "../components/PropertiesPanel";
import CommentsOverlay from "../components/CommentsOverlay";
import CursorsOverlay from "../components/CursorsOverlay";
import UsernameModal from "../components/UsernameModal";
import PresentationView from "../components/PresentationView";
import { listScreens, screenForSelection } from "../utils/screens";
import { loadStarter, type StarterId } from "../starter/starters";
import { exportProject, importProject, validateSnapshot, type ProjectSnapshot } from "../utils/projectFile";
import { savedMessage } from "../utils/saveFile";
import { extractErrorMessage } from "../utils/errorMessage";
import { useToast } from "../contexts/ToastContext";
import styles from "./CanvasPage.module.css";

function normalizeCursor(c: CursorState): CursorState {
  return { ...c, updatedAt: c.updatedAt ?? c.updated_at ?? 0 };
}

export default function CanvasPage() {
  countRender("CanvasPage");
  const { teamId, projectId } = useParams<{ teamId: string; projectId: string }>();
  // The name each person set once for the whole team, shared by every app on it.
  const teamNames = useMemberNames(teamId);
  // Selector, not the bare store. `useCanvasStore()` subscribes to every field,
  // so selecting a shape — which touches nothing this page renders — used to
  // re-render CanvasPage and, through it, the canvas, the toolbar and the whole
  // layers tree. Measured at 300 elements: 309ms p95 for a click. See e2e/perf/.
  const {
    setElements, upsertElement, applyRemoteElements, removeRemoteElements, cacheImage, selectWithPointer, elements, imageCache,
    previewMode, setPreviewMode, presenting, startPresentation,
  } =
    useCanvasStore(
      useShallow((s) => ({
        setElements: s.setElements,
        upsertElement: s.upsertElement,
        applyRemoteElements: s.applyRemoteElements,
        removeRemoteElements: s.removeRemoteElements,
        cacheImage: s.cacheImage,
        selectWithPointer: s.selectWithPointer,
        elements: s.elements,
        imageCache: s.imageCache,
        previewMode: s.previewMode,
        setPreviewMode: s.setPreviewMode,
        presenting: s.presentation !== null,
        startPresentation: s.startPresentation,
      })),
    );
  const { showToast } = useToast();

  const canvasRef = useRef<FabricCanvasHandle>(null);

  // Collaboration state
  const [comments, setComments] = useState<CanvasComment[]>([]);
  const [cursors, setCursors] = useState<CursorState[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [showUsernameModal, setShowUsernameModal] = useState(false);
  const [nameSuggestion, setNameSuggestion] = useState("");
  // This account's username on THIS board's contract: "" for none, null until
  // `get_members` has answered (or when it could not).
  const [boardName, setBoardName] = useState<string | null>(null);
  const [addingComment, setAddingComment] = useState(false);
  // What this session's pointer is keyed by on the board: the account (v1:
  // the device's context key).
  const [myIdentity, setMyIdentity] = useState("");
  // Who the signed-in user IS: the account. The board keys members, comment
  // authors and element creators by account, so every "is this me / mine"
  // check compares against this.
  const [myAccount, setMyAccount] = useState("");
  // Effective canvas permission for this identity (admin/editor → true, viewer → false).
  // The contract enforces this at merge; this flag is for read-only UX.
  const [canEdit, setCanEdit] = useState(true);
  // Whether this identity is the board admin/owner. Admin-only board ops
  // (clear, project import which replaces the board) are gated on this.
  const [isAdmin, setIsAdmin] = useState(false);
  const [viewport, setViewport] = useState({ zoom: 1, panX: 0, panY: 0 });
  // ⌘G / ⇧⌘G. Same implementation the layers panel's buttons use.
  const { groupSelection, ungroupSelection } = useGroupActions(projectId ?? "", !canEdit);
  const cursorThrottleRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // "loading" = first attempt; "syncing" = the board could not be read yet, retrying
  const [syncStatus, setSyncStatus] = useState<"loading" | "syncing" | "ready">("loading");
  const [syncError, setSyncError] = useState<string | null>(null);
  const [syncTrigger, setSyncTrigger] = useState(0);
  const syncRetryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const syncRetryCountRef = useRef(0);

  // The pointer is keyed by account now: one per person, whatever the device.
  const refreshIdentity = useCallback((shouldApply: () => boolean = () => true) => {
    if (!projectId) return;
    getNodeIdentity()
      .then((me) => {
        if (me.accountId && shouldApply()) setMyIdentity(me.accountId);
      })
      .catch(() => {});
  }, [projectId]);

  useEffect(() => {
    let cancelled = false;
    refreshIdentity(() => !cancelled);
    return () => { cancelled = true; };
  }, [refreshIdentity]);

  useEffect(() => {
    let cancelled = false;
    getNodeIdentity()
      .then((me) => { if (!cancelled) setMyAccount(me.accountId ?? ""); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  /**
   * Escape, and the group shortcuts.
   *
   * Escape used to unconditionally clear preview AND comment mode on every
   * press, wherever it came from. It now does one thing at a time, in the order
   * a user expects — leave preview, else cancel comment placement, else let the
   * canvas delete the selection (FabricCanvas), else nothing — and it never
   * leaves this page: `preventDefault` on the canvas board stops the browser or
   * the desktop shell acting on the same key. With nothing selected it is a
   * deliberate no-op.
   *
   * The listener is registered in the capture phase so it runs before anything
   * outside the app that might be listening for the same key, but it does not
   * stop propagation: FabricCanvas's own handler (which owns deletion) still has
   * to see it.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (showUsernameModal) return;
      // Presentation mode owns the keyboard (PresentationView): Escape there
      // leaves the presentation, and must not also reach the checks below.
      if (presenting) return;

      const mod = e.metaKey || e.ctrlKey;
      const tag = (document.activeElement as HTMLElement | null)?.tagName?.toLowerCase();
      const typing = tag === "input" || tag === "textarea" || tag === "select";

      if (mod && (e.key === "g" || e.key === "G") && !typing) {
        e.preventDefault();
        if (e.shiftKey) void ungroupSelection();
        else void groupSelection();
        return;
      }

      if (e.key !== "Escape") return;
      if (typing) return; // the focused field owns its own Escape

      // Leaving preview or cancelling a comment CONSUMES the key:
      // `stopImmediatePropagation` keeps it from reaching the canvas handler,
      // which would otherwise delete the selected element on the same press.
      if (previewMode) {
        e.preventDefault();
        e.stopImmediatePropagation();
        setPreviewMode(false);
        return;
      }
      if (addingComment) {
        e.preventDefault();
        e.stopImmediatePropagation();
        setAddingComment(false);
        return;
      }
      // Anything left is the canvas's to handle (delete the selection, or —
      // with nothing selected — do nothing). Keep the key inside the app.
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [setPreviewMode, showUsernameModal, previewMode, addingComment, groupSelection, ungroupSelection, presenting]);

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
    // Drop the previous board's permission so it can't briefly authorize edits
    // on a view-only project before this project's role resolves. Default to
    // read-only on switch; the role effect re-grants edit/admin access if held.
    setCanEdit(false);
    setIsAdmin(false);
    syncRetryCountRef.current = 0;
    // Guard all async work against project navigation: a slow read from a
    // previous project must not mutate state or schedule a retry for a canvas
    // the user has already left.
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
        .catch((err) => {
          if (cancelled) return;
          const msg: string = err?.message ?? String(err);
          // Every member of the team reaches its boards at once: there is no
          // context to join and nothing to sync first (v1 joined here). A
          // failure is the cluster or the board itself; retry, and say why.
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
        // A blob of this board's app instance. See getBlob.
        getBlob(blobId, projectId!)
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

  // This board's roster, and whether this account is on it under a name.
  useEffect(() => {
    setBoardName(null);
    if (!projectId || !myIdentity || !myAccount) return;
    // Guard against a slow get_members from the previous project repopulating the
    // roster (and mislabeling cursors) after the user switched canvases.
    let cancelled = false;
    rpcCall<Member[]>(projectId, "get_members", {})
      .then((ms) => {
        if (cancelled) return;
        const list = Array.isArray(ms) ? ms : [];
        setMembers(list);
        const member = list.find((m) => m.id === myAccount);
        setBoardName(member?.username?.trim() ?? "");
      })
      .catch(() => {
        // Unknown, not "unnamed": the decision below falls back to the team.
        if (!cancelled) setBoardName("");
      });
    return () => { cancelled = true; };
  }, [projectId, myIdentity, myAccount]);

  // ── Your name: one per TEAM, never per board ──────────────────────────────
  //
  // A name used to be asked for on every board, because each board's contract
  // keeps its own roster and a new board's roster has never heard of you. The
  // name belongs to the person in the team (namespace member metadata), so it
  // is asked for once there and every board is joined under it silently. The
  // board roster still gets the name (`join`), because the contract's own
  // views read it; it is just never the thing that decides whether to ask.
  const myName = useMyName(teamId, myAccount);

  async function joinBoardAs(username: string) {
    if (!projectId || !myIdentity) return;
    // The member id is the caller's account, set by the contract.
    await rpcCall(projectId, "join", {
      username,
      avatar: null,
      timestamp: Date.now(),
    }).catch(() => {});
    setBoardName(username);
    rpcCall<Member[]>(projectId, "get_members", {})
      .then((ms) => setMembers(Array.isArray(ms) ? ms : []))
      .catch(() => {});
  }

  // Only for a team made before names were asked on create/join: asked once,
  // for the team, then never again on any of its boards.
  async function handleUsernameSubmit(username: string) {
    setShowUsernameModal(false);
    // Best-effort: the board is joined either way, and a refused team write
    // is asked again next time rather than lost.
    await myName.setName(username).catch(() => {});
    await joinBoardAs(username);
  }

  // Decide once both answers are in: the team's (is there a name for you at
  // all?) and this board's (is it already on the roster?). Asking before the
  // team's names have loaded is what made people re-enter their name.
  useEffect(() => {
    const action = decideBoardName({
      teamReady: myName.ready,
      teamName: myName.name,
      boardName,
      legacyName: legacyUsername(myIdentity),
    });
    if (action.kind === "ask") {
      setNameSuggestion(action.suggestion || legacyUsername(myIdentity));
      setShowUsernameModal(true);
      return;
    }
    if (action.kind !== "use") return;
    setShowUsernameModal(false);
    if (action.adopt) void myName.setName(action.name).catch(() => {});
    if (action.join) void joinBoardAs(action.name);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myName.ready, myName.name, boardName]);

  // Resolve this identity's role. Viewers get a read-only canvas; only the
  // admin/owner may run board-replace ops (import). Re-checked when the roster
  // changes (e.g. an admin just granted us editor). On a transient RPC failure
  // we fail CLOSED (read-only) — never hand a viewer edit UI; the contract is
  // the real boundary and a real editor's access restores on the next resolve.
  useEffect(() => {
    if (!projectId || !myIdentity) return;
    let cancelled = false;
    rpcCall<string>(projectId, "my_role", {})
      .then((role) => {
        if (cancelled) return;
        setCanEdit(role !== "viewer");
        setIsAdmin(role === "admin");
      })
      .catch(() => { if (!cancelled) { setCanEdit(false); setIsAdmin(false); } });
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
  // Folded into one plan per mutation (utils/boardEvents): a batch of N element
  // changes is one `get_elements_by_ids` pass and one store update, not N
  // `get_element` reads and N re-renders.
  const handleSseEvent = useCallback(
    (raw: unknown) => {
      if (!projectId) return;
      const changes = collectBoardChanges(raw);

      if (changes.remove.length > 0) removeRemoteElements(changes.remove);
      if (changes.layers) {
        // A reorder renumbers everything; the full list covers any fetch too.
        rpcCall<Element[]>(projectId, "get_elements", {})
          .then((els) => setElements(Array.isArray(els) ? els : []))
          .catch(() => {});
      } else if (changes.fetch.length > 0) {
        getElementsByIds(projectId, changes.fetch)
          .then((els) => applyRemoteElements(els))
          .catch(() => {});
      }
      if (changes.comments) {
        rpcCall<CanvasComment[]>(projectId, "get_comments", {})
          .then((cs) => setComments(Array.isArray(cs) ? cs : []))
          .catch(() => {});
      }
      if (changes.removedComments.length > 0) {
        const gone = new Set(changes.removedComments);
        setComments((prev) => prev.filter((c) => !gone.has(c.id)));
      }
      if (changes.cursors) {
        rpcCall<CursorState[]>(projectId, "get_cursors", {})
          .then((cs) => setCursors(Array.isArray(cs) ? cs.map(normalizeCursor) : []))
          .catch(() => {});
      }
      if (changes.role) {
        // A grant/revoke/transfer may flip our own role — re-resolve it
        // immediately instead of waiting for a reload.
        rpcCall<string>(projectId, "my_role", {})
          .then((role) => { setCanEdit(role !== "viewer"); setIsAdmin(role === "admin"); })
          // Fail closed, matching the role effect — never keep stale edit
          // access after a revoke/transfer if the refetch errors.
          .catch(() => { setCanEdit(false); setIsAdmin(false); });
      }
      if (changes.members) {
        rpcCall<Member[]>(projectId, "get_members", {})
          .then((ms) => setMembers(Array.isArray(ms) ? ms : []))
          .catch(() => {});
      }
    },
    [projectId, applyRemoteElements, removeRemoteElements, setElements],
  );

  // The stream dropped and came back (the node was restarted, the machine
  // slept): every event from the gap is lost, so re-read the whole board. In
  // place — unlike the initial load, which clears the canvas first — so a
  // reconnect is invisible when nothing changed. A new roster re-runs the role
  // effect, which covers a grant or revoke made while we were away.
  const resyncBoard = useCallback(() => {
    if (!projectId) return;
    rpcCall<Element[]>(projectId, "get_elements", {})
      .then((els) => setElements(Array.isArray(els) ? els : []))
      .catch(() => {});
    rpcCall<CanvasComment[]>(projectId, "get_comments", {})
      .then((cs) => setComments(Array.isArray(cs) ? cs : []))
      .catch(() => {});
    rpcCall<CursorState[]>(projectId, "get_cursors", {})
      .then((cs) => setCursors(Array.isArray(cs) ? cs.map(normalizeCursor) : []))
      .catch(() => {});
    rpcCall<Member[]>(projectId, "get_members", {})
      .then((ms) => setMembers(Array.isArray(ms) ? ms : []))
      .catch(() => {});
  }, [projectId, setElements]);

  useSse(projectId ?? null, handleSseEvent, resyncBoard);

  async function handleSaveProject() {
    if (!projectId) return;
    // Swallowing this is how item 9 stayed invisible for so long: the save
    // rejected in the desktop app and the UI said nothing at all.
    try {
      const filename = await exportProject(projectId);
      if (filename) showToast(savedMessage("Project", filename), "success");
    } catch (e) {
      showToast(extractErrorMessage(e, "Could not save the project file"), "error");
    }
  }

  /** Replaces the board with a snapshot. Rejects if the write failed; the board is re-read either way. */
  async function handleImportProject(snapshot: ProjectSnapshot) {
    if (!projectId) return;
    try {
      await importProject(projectId, snapshot);
    } finally {
      rpcCall<Element[]>(projectId, "get_elements", {})
        .then((els) => setElements(Array.isArray(els) ? els : []))
        .catch(() => {});
      rpcCall<CanvasComment[]>(projectId, "get_comments", {})
        .then((cs) => setComments(Array.isArray(cs) ? cs : []))
        .catch(() => {});
    }
  }

  /** Open (.merodesign): the toolbar has already parsed, validated and confirmed the file. */
  async function handleOpenProjectFile(snapshot: ProjectSnapshot) {
    showToast(`Opening project — ${snapshot.elements.length} elements…`, "info");
    try {
      await handleImportProject(snapshot);
      showToast("Project opened", "success");
    } catch (e) {
      showToast(extractErrorMessage(e, "Could not open the project file"), "error");
    }
  }

  /**
   * Loads a bundled starter project and persists it into contract state: the
   * same path as Open (.mero-design), so every element lands in WASM via
   * add_element and reaches every other member, rather than living in local
   * canvas state. Each file is imported on demand (see `starters.ts`), and
   * validated before use so a bad asset cannot wipe a board and leave nothing
   * behind.
   */
  async function handleOpenStarter(id: StarterId) {
    if (!projectId || !isAdmin) return;
    try {
      const snapshot: unknown = JSON.parse(await loadStarter(id));
      if (!validateSnapshot(snapshot)) {
        showToast("Starter project is malformed — nothing was changed", "error");
        return;
      }
      showToast(`Loading ${snapshot.elements.length} elements…`, "info");
      await handleImportProject(snapshot);
      showToast(
        id === "presentation" ? "Presentation loaded — press ▶ Present to play it" : "Starter project loaded",
        "success",
      );
    } catch (e) {
      showToast(extractErrorMessage(e, "Could not load the starter project"), "error");
    }
  }

  async function handleImageUpload(
    file: File, dataUrl: string, naturalWidth: number, naturalHeight: number,
  ) {
    // Adding an image is an edit (add_element) — viewers are read-only. The
    // toolbar disables the control, but gate the handler too against any path.
    if (!projectId || !canEdit) return;
    const maxW = 400;
    const scale = naturalWidth > maxW ? maxW / naturalWidth : 1;
    const id = uuid();

    // Upload the image as a blob of this board, so every member can read it.
    let blobId = "";
    try {
      const buf = await file.arrayBuffer();
      const result = await uploadBlob(buf, projectId);
      blobId = result?.blobId ?? "";
    } catch (err) {
      console.error("[MeroDesign] blob upload failed — image will only be visible this session:", err);
      showToast(extractErrorMessage(err, "The image could not be uploaded; it is visible only in this session."));
    }

    const el: Element = {
      id,
      data: { kind: "image", naturalWidth, naturalHeight, blobId },
      x: 40, y: 40,
      width: Math.round(naturalWidth * scale), height: Math.round(naturalHeight * scale),
      rotation: 0, fill: "transparent", stroke: "transparent", strokeWidth: 0, opacity: 100,
      layerIndex: elements.length,
      createdBy: myAccount, createdAt: Date.now(), updatedAt: Date.now(),
    };
    cacheImage(id, dataUrl);
    upsertElement(el);
    // The image is placed; the image tool has nothing left to do and would only
    // sit lit in the toolbar. Hand back the pointer with the new image selected,
    // the same way a drawn shape does.
    //
    // Only if the tool is still the one that started this, though. A shape or a
    // text hands off in the same tick as the click, but this path waits on a
    // blob upload first — seconds, for a large image — and in that window the
    // user may well have picked another tool. Yanking it back when the upload
    // finally lands is worse than leaving the toolbar as they set it.
    if (useCanvasStore.getState().activeTool === "image") selectWithPointer(id);
    await rpcCall(projectId, "add_element", { element: el }).catch(() => {});
  }

  // Not readable yet. The first read is usually quick, so "loading" shows an
  // empty sheet rather than flashing a message; "syncing" (a read failed and is
  // being retried) says so over the shell, with the rest of the app — the
  // rail, the switcher — still in reach.
  if (syncStatus !== "ready") {
    return (
      <div className={styles.root}>
        <div className={styles.workspace}>
          <div className={styles.canvasWrap} data-testid="board-pending" aria-busy="true">
            <div className={styles.syncWrap}>
              {(syncStatus === "syncing" || !!syncError) && (
                <div role="status">
                  {syncError ? (
                    <span className={styles.syncError} role="alert">{syncError}</span>
                  ) : (
                    <>
                      Opening this board&hellip;{" "}
                      <span className={styles.syncHint}>The first read did not answer; trying again.</span>
                    </>
                  )}{" "}
                  <button className={styles.syncRetry} onClick={() => setSyncTrigger((n) => n + 1)}>
                    Retry now
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  /** Present from the screen holding the selection, else from the first. */
  function handlePresent() {
    const { elements: els, elementLabels, selectedElementIds } = useCanvasStore.getState();
    const ids = new Set(selectedElementIds);
    const start = screenForSelection(listScreens(els, elementLabels), els.filter((e) => ids.has(e.id)));
    startPresentation(start?.id ?? null);
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
          initialValue={nameSuggestion}
        />
      )}
      <Toolbar
        contextId={projectId ?? ""}
        onExportPng={() => canvasRef.current?.exportPng()}
        onExportSvg={() => canvasRef.current?.exportSvg()}
        onPreview={() => setPreviewMode(true)}
        onPresent={handlePresent}
        onImageUpload={handleImageUpload}
        addingComment={addingComment}
        onToggleComment={() => setAddingComment((v) => !v)}
        members={cursors.filter((c) => c.identity !== myIdentity && Date.now() - c.updatedAt < 30_000)}
        onSaveProject={handleSaveProject}
        onImportProject={handleOpenProjectFile}
        readOnly={!canEdit}
        canImport={isAdmin}
        memberList={members}
        teamName={teamNames.nameOf}
        onOpenStarter={handleOpenStarter}
        boardHasContent={elements.length > 0}
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
          <CursorsOverlay
            cursors={cursors}
            myIdentity={myIdentity}
            members={members}
            teamName={teamNames.nameOf}
            viewport={viewport}
          />
          <CommentsOverlay
            members={members}
            teamName={teamNames.nameOf}
            contextId={projectId ?? ""}
            comments={comments}
            myIdentity={myAccount}
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
          {elements.length === 0 && (
            // A blank board says what to do next. It never takes a pointer:
            // the first drag has to land on the canvas under it.
            <div className={styles.emptyHint} aria-hidden="true" data-testid="board-empty-hint">
              <span className={styles.emptyHintIcons}>
                <svg viewBox="0 0 24 24" width="22" height="22"><rect x="3" y="5" width="18" height="14" rx="3" fill="none" stroke="currentColor" strokeWidth="1.8" /></svg>
                <svg viewBox="0 0 24 24" width="22" height="22"><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="1.8" /></svg>
                <svg viewBox="0 0 24 24" width="22" height="22"><path d="M5 6h14M12 6v13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
              </span>
              <strong className={styles.emptyHintTitle}>{canEdit ? "A blank board" : "Nothing on this board yet"}</strong>
              <span className={styles.emptyHintText}>
                {canEdit
                  ? "Pick a shape from the toolbar and drag on the board to draw it."
                  : "You can look around; editors will fill it in."}
              </span>
            </div>
          )}
        </div>
        <PropertiesPanel contextId={projectId ?? ""} readOnly={!canEdit} />
      </div>
      {/* Over the board, not instead of it: the canvas keeps its zoom, pan and
          selection, and a peer's edit still lands on the slide being shown. */}
      {presenting && <PresentationView />}
    </div>
  );
}
