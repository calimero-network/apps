/**
 * AppPage — the full spreadsheet workspace.
 *
 * Layout (full viewport, the light-glass look: frosted frame floating on the
 * tinted ground, the sheet itself one solid card so the grid stays crisp):
 *   ╭──────── TopBar: back · name · live · people · Invite · ☾ · Log out ──╮
 *   ╭──────── ToolDock: file · undo/redo · panels ─────────────────────────╮
 *   ╭──────── SheetCard ───────────────────────────────────────────────────╮
 *   │ FormatBar                                                            │
 *   │ FormulaBar                                                           │
 *   │                         SpreadsheetGrid                              │
 *   │ SheetTabs                                                            │
 *   ╰──────────────────────────────────────────────────────────────────────╯
 *     StatusBar
 *
 * Panels (functions, comments, …) float in from the right as overlays.
 *
 * Three states:
 *  1. Workspace picker (!ws.contextId) — open / create a workspace
 *  2. Opening (ws.contextId set, !ws.ready) — identity resolving
 *  3. Workspace open — full spreadsheet UI (with ← back to the picker)
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import styled, { keyframes } from 'styled-components';
import { useLocation, useNavigate } from 'react-router-dom';
import { useGroupMembers, useMero } from '@calimero-network/mero-react';
import { useMemberNames, useMyName } from '@calimero-apps/names';
import { C } from '../../theme';
import ThemeToggle from '../../components/ThemeToggle';
import { field, primaryPill, secondaryPill } from '../../components/glass';
import { APP_DISPLAY_NAME } from '../../config';
import { useWorkspace } from '../../hooks/useWorkspace';
import { useSpreadsheet } from '../../hooks/useSpreadsheet';
import { describeError } from '../../utils/errors';
import { cellRef } from '../../components/FormulaBar';
import { isFormula, insertReference, type AutoRef } from '../../spreadsheet/formulaEdit';
import { JoinSyncBanner } from '@calimero-network/mero-react';
import { columnLabel, normalizeRect, rangeRef, sheetPrefix, rectCells, type CellCoord, type Rect } from '../../spreadsheet/refs';
import { planFill } from '../../spreadsheet/fill';
import { toTSV, fromTSV } from '../../spreadsheet/clipboard';
import { planPaste, type ClipPayload, type ClipCell, type PasteWrite } from '../../spreadsheet/paste';
import { setOp, formatOp, clearOp, type CellOp } from '../../spreadsheet/ops';
import FormulaBar from '../../components/FormulaBar';
import SpreadsheetGrid from '../../components/SpreadsheetGrid';
import SheetTabs from '../../components/SheetTabs';
import FunctionHelpPanel from '../../components/FunctionHelpPanel';
import InviteModal from '../../components/InviteModal';
import NicknameModal from '../../components/NicknameModal';
import ContextMenu from '../../components/ContextMenu';
import NamesModal from '../../components/NamesModal';
import ActivityPanel from '../../components/ActivityPanel';
import CommentsPanel from '../../components/CommentsPanel';
import NotePanel from '../../components/NotePanel';
import PeoplePanel, { type ReplicaPolicy } from '../../components/PeoplePanel';
import { NO_REPLICA_POLICY, replicaPolicyFrom, storeReplicaPolicy } from '../../spreadsheet/replicas';
import ProtectModal from '../../components/ProtectModal';
import FormatBar from '../../components/FormatBar';
import RulesModal, { conditionLabel } from '../../components/RulesModal';
import ChartsPanel from '../../components/ChartsPanel';
import AttachmentsPanel from '../../components/AttachmentsPanel';
import LinksPanel from '../../components/LinksPanel';
import { readXlsx, writeXlsx, type BookSheet } from '../../spreadsheet/xlsx';
import { parseCsv } from '../../spreadsheet/csv';
import FilterModal from '../../components/FilterModal';
import { dataRegion, looksLikeHeader, planSort, sortOrder } from '../../spreadsheet/sort';
import { columnValues, hiddenRows, withColumn, type FilterView } from '../../spreadsheet/filter';
import { chartModel } from '../../spreadsheet/chart';
import { syncView } from '../../spreadsheet/sync';
import { NO_EFFECT, placeRules, ruleEffect, scaleBounds } from '../../spreadsheet/styling';
import { conditionDescribe, conditionMatches } from '../../engine/engine';
import { lockedReason, placeProtections } from '../../spreadsheet/access';
import { GRID_COLS, GRID_ROWS } from '../../spreadsheet/viewport';
import type { NoteOp } from '../../spreadsheet/notes';
import { ago, nsToMs } from '../../lib/time';
import { sheetsToCsv } from '../../spreadsheet/download';
import { idsToNames, namesToIds } from '../../spreadsheet/sheetref';
import StatusBar from '../../components/StatusBar';
import { avatarLabel, distinctCollaborators, peerCount } from '../../spreadsheet/presence';
import { useSheetPresence } from '../../hooks/useSheetPresence';
import { labelMembers, labelsById, withNamespaceNames } from '../../lib/people';
import { isUsableName, normaliseName, rememberName, rememberedName } from '../../lib/displayName';
import { forgetLastWorkspace } from '../../lib/lastWorkspace';


export default function AppPage() {
  const { logout, admin, nodeUrl, isDelegated } = useMero();
  const ws = useWorkspace();
  const [activeSheetId, setActiveSheetId] = useState<string | null>(null);
  const ss = useSpreadsheet({
    contextId: ws.contextId,
    executorPublicKey: ws.executorPublicKey,
    activeSheetId,
  });
  const navigate = useNavigate();

  // An invitation the app-level prompt just joined arrives as navigation state
  // (see `AppInvitations` in App.tsx): this page is usually already showing,
  // so the state — not a remount — is what makes it re-read the node and open
  // what was joined. Cleared once handled, so a reload does not replay it.
  const location = useLocation();
  const joined = (location.state as {
    joined?: Parameters<typeof ws.landJoined>[0];
  } | null)?.joined;
  const { landJoined } = ws;
  useEffect(() => {
    if (!joined) return;
    void landJoined(joined);
    navigate(location.pathname, { replace: true, state: null });
  }, [joined, landJoined, navigate, location.pathname]);

  // Log out: mero-react drops this browser's node session (tokens and all),
  // and the front door is where a signed-out visitor belongs. The spreadsheet
  // remembered for a reload goes too: the next sign-in starts at the picker.
  const signOut = useCallback(() => {
    forgetLastWorkspace(nodeUrl);
    logout();
    navigate('/', { replace: true });
  }, [logout, navigate, nodeUrl]);

  // id↔name resolvers for translating formulas at the frontend boundary: the
  // engine/store deal in canonical sheet ids; the formula bar shows names.
  // Private sheets resolve too, so a private formula can name one; a shared
  // cell that tries is refused at the write.
  const allSheets = useMemo(() => [...ss.sheets, ...ss.privateSheets], [ss.sheets, ss.privateSheets]);
  const privateIds = useMemo(() => new Set(ss.privateSheets.map((s) => s.id)), [ss.privateSheets]);
  const isPrivateActive = !!activeSheetId && privateIds.has(activeSheetId);
  // A linked sheet is pushed from another workbook: read-only here.
  const activeLinkedFrom = ss.sheets.find((x) => x.id === activeSheetId)?.linked_from ?? '';
  const idToName = useCallback(
    (id: string) => allSheets.find((s) => s.id === id)?.name ?? null,
    [allSheets],
  );
  const nameToId = useCallback(
    (name: string) => allSheets.find((s) => s.name === name)?.id ?? null,
    [allSheets],
  );

  // ── Workspace modals ────────────────────────────────────────────
  const [showInvite, setShowInvite] = useState(false);
  // The minted code lives here rather than inside InviteModal, because minting
  // is a network call against the namespace and the modal is a presentation of
  // its result — keeping them together made the dialog either mint on every open
  // or show a stale invitation from a previous one.
  const [inviteCode, setInviteCode] = useState('');
  const [inviteError, setInviteError] = useState<string | null>(null);

  const openInvite = useCallback(async () => {
    setShowInvite(true);
    setInviteCode('');
    setInviteError(null);
    try {
      setInviteCode(
        await ws.invite({ contextId: ws.contextId, projectName: ws.activeName }),
      );
    } catch (err) {
      setInviteError(describeError(err));
    }
  }, [ws]);

  // ── Nickname ────────────────────────────────────────────────────
  // Asked once per spreadsheet, the first time this device opens one it has not
  // named itself in. The name goes to the CONTRACT (`join`), because a name in
  // localStorage is visible only to the person who already knows it. What the
  // browser remembers is the SUGGESTION, so the second spreadsheet does not ask
  // again from scratch.
  const [savingNickname, setSavingNickname] = useState(false);
  const [nicknameError, setNicknameError] = useState<string | null>(null);
  const [nicknameSkipped, setNicknameSkipped] = useState(false);
  // Per spreadsheet, not per session: skipping in one should not leave you
  // silently unnamed in the next one you open.
  useEffect(() => {
    setNicknameSkipped(false);
    setNicknameError(null);
  }, [ws.contextId]);
  const needsNickname =
    !nicknameSkipped &&
    ss.ready &&
    ss.membersLoaded &&
    ss.selfId !== null &&
    !ss.members.some((m) => m.id === ss.selfId && m.nickname.trim());

  // The name each person set for the whole workspace (namespace member
  // metadata), shared by every app on it. It names people who have not picked
  // a nickname in this workbook, or have not opened it at all.
  const { nameOf: namespaceNameOf, displayName: namespaceDisplayName } = useMemberNames(admin, ws.namespaceId);
  // Your own name is the workspace's, one per workspace: a workbook asks only
  // when the workspace has none for you, and only once its names have loaded.
  const myName = useMyName(admin, ws.namespaceId, ss.selfId);
  const selfNamespaceName = normaliseName(myName.name);

  const submitNickname = useCallback(
    async (name: string) => {
      setSavingNickname(true);
      setNicknameError(null);
      try {
        await ss.joinAs(name);
        rememberName(name);
        // The workspace-wide name too, so every other app on it says the same.
        // Best-effort: the workbook nickname is what was asked for.
        if (name !== selfNamespaceName) void myName.setName(name).catch(() => undefined);
      } catch (err) {
        setNicknameError(describeError(err));
      } finally {
        setSavingNickname(false);
      }
    },
    [ss, myName, selfNamespaceName],
  );

  // Someone who already named themselves for the workspace is not asked again:
  // the workbook adopts that name. Once per spreadsheet; if the write fails,
  // the modal opens with the name filled in and the error shown.
  const adoptedFor = useRef<string | null>(null);
  const adoptNamespaceName = needsNickname && isUsableName(selfNamespaceName) && !nicknameError;
  useEffect(() => {
    if (!adoptNamespaceName || adoptedFor.current === ws.contextId) return;
    adoptedFor.current = ws.contextId;
    void submitNickname(selfNamespaceName);
  }, [adoptNamespaceName, ws.contextId, selfNamespaceName, submitNickname]);

  // ── New-workspace bootstrap ─────────────────────────────────────
  const [projectName, setProjectName] = useState('Untitled Spreadsheet');

  // A freshly-created workspace must be initialised with its project name once
  // its context is ready (the client is available by then). `ws.pendingInitName`
  // is set by createWorkspace and cleared here after init runs, so it fires once
  // per newly-created workspace and never when opening an existing one.
  const initProjectRef = useRef(ss.initProject);
  useEffect(() => { initProjectRef.current = ss.initProject; });
  const initedRef = useRef<string | null>(null);
  useEffect(() => {
    if (ws.ready && ws.contextId && ws.pendingInitName && initedRef.current !== ws.contextId) {
      initedRef.current = ws.contextId;
      const name = ws.pendingInitName;
      ws.clearPendingInit();
      void initProjectRef.current(name);
    }
  }, [ws.ready, ws.contextId, ws.pendingInitName, ws]);

  // ── Spreadsheet state ───────────────────────────────────────────
  const [selectedCell, setSelectedCell] = useState<CellCoord | null>(null);
  const [selectionRange, setSelectionRange] = useState<Rect | null>(null);
  const [clipboard, setClipboard] = useState<ClipPayload | null>(null);
  const [formulaInput, setFormulaInput] = useState('');
  const [isDirty, setIsDirty] = useState(false);
  // Edit mode: true while actively editing the selected cell (entered by typing,
  // F2, double-click, or clicking into the formula bar). Distinct from mere
  // selection — that's what lets a plain click navigate but a click while
  // editing a formula insert a reference.
  const [editing, setEditing] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const [showNames, setShowNames] = useState(false);
  const [showActivity, setShowActivity] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [showPeople, setShowPeople] = useState(false);
  const [replicaPolicy, setReplicaPolicy] = useState<ReplicaPolicy | null>(null);
  const [showProtect, setShowProtect] = useState(false);
  const [protectSaving, setProtectSaving] = useState(false);
  const [protectError, setProtectError] = useState<string | null>(null);
  const [rulesMode, setRulesMode] = useState<'format' | 'validate' | 'alert' | null>(null);
  const [rulesSaving, setRulesSaving] = useState(false);
  const [rulesError, setRulesError] = useState<string | null>(null);
  const [showCharts, setShowCharts] = useState(false);
  const [showFiles, setShowFiles] = useState(false);
  const [showLinks, setShowLinks] = useState(false);
  // What an import is doing, while it runs.
  const [importing, setImporting] = useState<string | null>(null);
  const importInput = useRef<HTMLInputElement>(null);
  // Filter views: yours alone, kept in this browser per workbook and sheet.
  const [filters, setFilters] = useState<Record<string, FilterView>>({});
  const [filterCol, setFilterCol] = useState<number | null>(null);
  // A list validation's choices, open under a cell.
  const [pick, setPick] = useState<{ row: number; col: number; options: string[]; x: number; y: number } | null>(null);
  // The cell whose note is open, by id so it stays on that cell as rows move.
  const [noteCell, setNoteCell] = useState<{ sheetId: string; rowId: string; colId: string } | null>(null);
  const [namesSaving, setNamesSaving] = useState(false);
  const [namesError, setNamesError] = useState<string | null>(null);
  const formulaInputRef = useRef<HTMLInputElement>(null);
  // The grid's key handler, for navigation keys pressed in the formula bar.
  const gridKeyRef = useRef<((e: React.KeyboardEvent) => void) | null>(null);
  // Marks the reference the last point-click inserted, so the next click can
  // replace it (Sheets behaviour: click A1 then B2 → `=B2`, not `=A1B2`).
  const autoRefRef = useRef<AutoRef | undefined>(undefined);
  // The cell whose formula is being edited (its "home"). Stays fixed while you
  // browse other sheet tabs to point-pick cells, so cross-sheet refs insert and
  // the commit lands back on the home cell. Null when not editing.
  const [editAnchor, setEditAnchor] = useState<{ sheetId: string; row: number; col: number } | null>(null);

  // Point mode: active while editing a formula. In this mode clicking/dragging
  // cells (or headers) inserts their reference into the formula instead of
  // moving the selection — standard spreadsheet flow.
  const pointMode = editing && isFormula(formulaInput);
  // While point-picking on a sheet other than the formula's home sheet, refs
  // are qualified with that sheet's name (`Data!A1`).
  const pickingForeignSheet = pointMode && editAnchor != null && editAnchor.sheetId !== activeSheetId;

  // Auto-select the first sheet when sheets load / change
  useEffect(() => {
    if (ss.sheets.length > 0) {
      const stillExists = allSheets.find((s) => s.id === activeSheetId);
      if (!stillExists) setActiveSheetId(ss.sheets[0].id);
    }
  }, [ss.sheets, allSheets, activeSheetId]);

  // Safety net: guarantee an editable sheet exists. The formula bar is disabled
  // without an active sheet, so a workspace with zero sheets opens read-only —
  // you can't type in any cell. `initProject` creates a default sheet for the
  // creator, but a context can become ready without that path (e.g. an
  // auto-created / externally-provisioned context), leaving it sheetless. When
  // the workspace is ready, finished its initial load, and is genuinely empty
  // (no sheets AND no cells — so we don't race a joiner mid-sync into creating
  // a duplicate), create one default sheet, once per opened workspace.
  const ensuredDefaultSheetRef = useRef<string | null>(null);
  // Contexts we created — their default sheet comes from initProject, so the
  // ensure-default safety net must not also create one (it would duplicate).
  const selfCreatedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (ws.contextId && ws.pendingInitName) selfCreatedRef.current.add(ws.contextId);
  }, [ws.contextId, ws.pendingInitName]);
  useEffect(() => {
    if (
      ss.ready &&
      ss.loaded && // the first fetch has resolved — empty is authoritative, not "not-yet-loaded"
      ss.sheets.length === 0 &&
      ss.cells.length === 0 &&
      ws.contextId &&
      !selfCreatedRef.current.has(ws.contextId) &&
      ensuredDefaultSheetRef.current !== ws.contextId
    ) {
      const contextId = ws.contextId;
      ensuredDefaultSheetRef.current = contextId;
      // A joiner can land here before the shared state has replicated: the
      // node answers `Uninitialized`, and the inviter's sheets are on their
      // way. Nothing to create yet — free the guard so a later change retries —
      // and never let it escape as an unhandled rejection.
      ss.createSheet('Sheet 1').catch((err: unknown) => {
        if (ensuredDefaultSheetRef.current === contextId) ensuredDefaultSheetRef.current = null;
        if (!/uninitiali[sz]ed/i.test(String((err as { message?: string })?.message ?? err))) {
          console.warn('[mero-sheets] could not create the default sheet', err);
        }
      });
    }
  }, [ss.ready, ss.loaded, ss.sheets.length, ss.cells.length, ss, ws.contextId]);

  // Reset per-workspace view state when switching workspaces.
  useEffect(() => {
    setActiveSheetId(null);
    setSelectedCell(null);
    setSelectionRange(null);
    setFormulaInput('');
    setIsDirty(false);
    setEditing(false);
    setEditAnchor(null);
  }, [ws.contextId]);

  // Sync formula bar when selected cell or cells data changes
  const prevCellRef = useRef<string | null>(null);
  useEffect(() => {
    const key = selectedCell ? `${activeSheetId}:${selectedCell.row}-${selectedCell.col}` : null;
    if (key === prevCellRef.current) return;
    prevCellRef.current = key;

    // Mid-edit the formula text is authoritative — don't let a sheet/cell key
    // change (e.g. switching tabs to point-pick a cross-sheet ref) overwrite it.
    if (editing) return;

    if (!selectedCell || !activeSheetId) {
      setFormulaInput('');
      setIsDirty(false);
      return;
    }
    const cell = ss.cells.find(
      (c) =>
        c.sheet_id === activeSheetId &&
        c.row === selectedCell.row &&
        c.col === selectedCell.col,
    );
    setFormulaInput(idsToNames(cell?.raw_value ?? '', idToName));
    setIsDirty(false);
  }, [selectedCell, activeSheetId, idToName]); // intentionally omit ss.cells so typing doesn't reset

  // ── Commit current cell ─────────────────────────────────────────
  const commitCellRef = useRef<(() => Promise<void>) | null>(null);
  const commitCell = useCallback(async () => {
    // The formula belongs to its home cell (editAnchor) even if you're viewing
    // another sheet to point-pick; otherwise it's the plain selected cell.
    const target =
      editAnchor ??
      (selectedCell && activeSheetId
        ? { sheetId: activeSheetId, row: selectedCell.row, col: selectedCell.col }
        : null);
    if (!target || !isDirty) return;
    const value = namesToIds(formulaInput, nameToId);
    // The write shows at once (an optimistic overlay, applied before its first
    // await), so the edit ends now, not when the node answers: by then the
    // next cell may be mid-edit, and ending "this" edit would discard it.
    const write = value.trim()
      ? ss.setCell(target.sheetId, target.row, target.col, value)
      : ss.clearCell(target.sheetId, target.row, target.col);
    setIsDirty(false);
    setEditing(false);
    setEditAnchor(null);
    autoRefRef.current = undefined;
    await write;
  }, [editAnchor, selectedCell, activeSheetId, isDirty, formulaInput, ss, nameToId]);

  // Keep ref current so SpreadsheetGrid can call it
  commitCellRef.current = commitCell;

  // Focus the formula bar after a selection so you can type immediately
  // (autofocus-on-select) without entering edit mode.
  const focusFormulaBar = useCallback(() => {
    requestAnimationFrame(() => {
      const el = formulaInputRef.current;
      if (el && !el.disabled) {
        el.focus();
        const len = el.value.length;
        el.setSelectionRange(len, len);
      }
    });
  }, []);

  // Pin the formula's home cell the first time an edit begins, so browsing to
  // another sheet to point-pick keeps the formula anchored there. No-op once set.
  const ensureEditAnchor = useCallback(() => {
    if (activeSheetId && selectedCell) {
      setEditAnchor((prev) =>
        prev ?? { sheetId: activeSheetId, row: selectedCell.row, col: selectedCell.col },
      );
    }
  }, [activeSheetId, selectedCell]);

  // ── Undo / redo: Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z, Ctrl+Y ────────────
  // While the formula bar holds an uncommitted edit, the keys belong to the
  // text field's own undo; otherwise they undo this user's sheet edits.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const key = e.key.toLowerCase();
      const isUndo = key === 'z' && !e.shiftKey;
      const isRedo = (key === 'z' && e.shiftKey) || (key === 'y' && !e.metaKey);
      if (!isUndo && !isRedo) return;
      if (isDirty) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest('[role="dialog"]')) return;
      e.preventDefault();
      void (isUndo ? ss.undo() : ss.redo());
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isDirty, ss]);

  // ── Presence: where you are, for everyone else's grid ─────────────
  const presence = useSheetPresence(ws.contextId, ss.selfId);
  const { publish: publishPresence } = presence;
  useEffect(() => {
    // Where you are on a private sheet is nobody else's business.
    publishPresence(
      activeSheetId && selectedCell && !isPrivateActive
        ? { sheetId: activeSheetId, row: selectedCell.row, col: selectedCell.col, range: selectionRange }
        : null,
    );
  }, [publishPresence, activeSheetId, selectedCell, selectionRange, isPrivateActive]);

  // ── Cell selection ──────────────────────────────────────────────
  const handleSelectCell = useCallback(
    async (row: number, col: number) => {
      // Commit the dirty cell, and move without waiting for the node (see
      // commitCell): a late move would undo whatever was done meanwhile.
      const write = isDirty && selectedCell && activeSheetId ? commitCellRef.current?.() : undefined;
      setSelectedCell({ row, col });
      setSelectionRange(null);
      setEditing(false);
      setEditAnchor(null);
      autoRefRef.current = undefined;
      focusFormulaBar();
      await write;
    },
    [isDirty, selectedCell, activeSheetId, focusFormulaBar],
  );

  // Drag-select a rectangular range; the focus (active) cell is the drag end.
  const handleSelectRange = useCallback(
    (a: CellCoord, b: CellCoord) => {
      setSelectedCell(b);
      setSelectionRange(normalizeRect(a, b));
      setEditing(false);
      setEditAnchor(null);
      autoRefRef.current = undefined;
    },
    [],
  );

  // Whole-column / whole-row selection from a header click.
  const handleSelectColumn = useCallback(
    async (col: number) => {
      const write = isDirty && selectedCell && activeSheetId ? commitCellRef.current?.() : undefined;
      setSelectedCell({ row: 0, col });
      setSelectionRange({ top: 0, left: col, bottom: GRID_ROWS - 1, right: col });
      setEditing(false);
      setEditAnchor(null);
      autoRefRef.current = undefined;
      focusFormulaBar();
      await write;
    },
    [isDirty, selectedCell, activeSheetId, focusFormulaBar],
  );
  const handleSelectRow = useCallback(
    async (row: number) => {
      const write = isDirty && selectedCell && activeSheetId ? commitCellRef.current?.() : undefined;
      setSelectedCell({ row, col: 0 });
      setSelectionRange({ top: row, left: 0, bottom: row, right: GRID_COLS - 1 });
      setEditing(false);
      setEditAnchor(null);
      autoRefRef.current = undefined;
      focusFormulaBar();
      await write;
    },
    [isDirty, selectedCell, activeSheetId, focusFormulaBar],
  );

  // Double-click / F2: enter edit mode on a cell and focus the formula bar.
  const handleEditCell = useCallback(
    (row: number, col: number) => {
      const already = selectedCell?.row === row && selectedCell?.col === col;
      if (!already) setSelectedCell({ row, col });
      setSelectionRange(null);
      setEditing(true);
      if (activeSheetId) setEditAnchor({ sheetId: activeSheetId, row, col });
      autoRefRef.current = undefined;
      requestAnimationFrame(() => formulaInputRef.current?.focus());
    },
    [selectedCell, activeSheetId],
  );

  // ── Who may do what: workbook role, protected ranges, and core's group
  //    roster for the workspace (who is in it at all, and who administers it).
  const { members: groupMembers, refetch: refetchGroup } = useGroupMembers(ws.namespaceId);
  // The group roster is read once by the hook; re-read it when someone joins
  // the workbook and whenever the People panel opens.
  useEffect(() => {
    if (showPeople) void refetchGroup();
  }, [showPeople, ss.members.length, refetchGroup]);
  // The always-on replica admission policy, read when the panel opens.
  //    The policy is a node's own setting (core has no delegated form of it), so
  //    an account session does not read it: the panel says it is not available.
  useEffect(() => {
    if (!showPeople || !admin || isDelegated || !ws.namespaceId) return;
    let live = true;
    admin.getTeeAdmissionPolicy(ws.namespaceId)
      .then((p) => { if (live) setReplicaPolicy(replicaPolicyFrom(p)); })
      .catch(() => { if (live) setReplicaPolicy(NO_REPLICA_POLICY); });
    return () => { live = false; };
  }, [showPeople, admin, isDelegated, ws.namespaceId]);
  const selfMember = ss.members.find((m) => m.id === ss.selfId);
  const myRole = selfMember?.role ?? 'editor';
  const isOwner = myRole === 'owner';
  const isGroupAdmin = !!selfMember?.account &&
    groupMembers.some((g) => g.identity === selfMember.account && g.role === 'Admin');
  const placed = activeSheetId && !isPrivateActive
    ? placeProtections(ss.protections, activeSheetId, (r, c) => ss.refOf(activeSheetId, r, c), ss.selfId, myRole)
    : [];
  // A private sheet is this node's alone: no role or protection applies.
  const selectedLock = activeLinkedFrom && selectedCell
    ? `Linked from ${activeLinkedFrom}: read-only`
    : selectedCell && !isPrivateActive ? lockedReason(placed, myRole, selectedCell.row, selectedCell.col) : null;

  // Refused writes explain themselves for a while, then go.
  const { writeError, dismissWriteError } = ss;
  useEffect(() => {
    if (writeError == null) return;
    const t = window.setTimeout(dismissWriteError, 8000);
    return () => window.clearTimeout(t);
  }, [writeError, dismissWriteError]);

  // ── Sheet view: frozen panes and row/column sizes (shared; editors change them)
  const { viewOf, setAxisSize, setFrozen } = ss;
  const activeView = useMemo(
    () => (activeSheetId && !isPrivateActive
      ? viewOf(activeSheetId)
      : { frozenRows: 0, frozenCols: 0, rowSizes: new Map<number, number>(), colSizes: new Map<number, number>() }),
    [activeSheetId, isPrivateActive, viewOf],
  );
  const canResize = !!activeSheetId && !isPrivateActive && (myRole === 'owner' || myRole === 'editor');
  // Dragging one of several selected whole columns (or rows) resizes them all.
  const handleResize = useCallback((axis: 'row' | 'col', index: number, size: number) => {
    if (!activeSheetId) return;
    const r = selectionRange;
    const whole = r && (axis === 'col'
      ? r.top === 0 && r.bottom === GRID_ROWS - 1 && index >= r.left && index <= r.right
      : r.left === 0 && r.right === GRID_COLS - 1 && index >= r.top && index <= r.bottom);
    const positions = whole
      ? Array.from({ length: axis === 'col' ? r.right - r.left + 1 : r.bottom - r.top + 1 }, (_, i) => (axis === 'col' ? r.left : r.top) + i)
      : [index];
    void setAxisSize(activeSheetId, axis, positions, size);
  }, [activeSheetId, selectionRange, setAxisSize]);

  // ── Styles and rules: the cell's own style, then what rules add ──────────
  const { stylesOf } = ss;
  const cellStyles = useMemo(
    () => (activeSheetId ? stylesOf(activeSheetId) : new Map<string, Record<string, string>>()),
    [activeSheetId, stylesOf],
  );
  const placedRules = useMemo(
    () => (activeSheetId ? placeRules(ss.rules, activeSheetId, (r, c) => ss.refOf(activeSheetId, r, c)) : []),
    // `ss.cells` changes when the layout does, so positions stay current.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeSheetId, ss.rules, ss.cells],
  );
  const scales = useMemo(() => scaleBounds(placedRules, ss.cells), [placedRules, ss.cells]);
  const ruleAt = useCallback(
    (row: number, col: number, value: string) => (placedRules.length === 0
      ? NO_EFFECT
      : ruleEffect(placedRules, scales, row, col, value, conditionMatches, conditionDescribe)),
    [placedRules, scales],
  );

  // Filter views live in this browser, per workbook.
  const filterKey = ws.contextId ? `sheets:filters:${ws.contextId}` : null;
  useEffect(() => {
    if (!filterKey) return;
    try {
      setFilters(JSON.parse(localStorage.getItem(filterKey) ?? '{}') as Record<string, FilterView>);
    } catch {
      setFilters({});
    }
  }, [filterKey]);
  const saveFilters = useCallback((next: Record<string, FilterView>) => {
    setFilters(next);
    try {
      if (filterKey) localStorage.setItem(filterKey, JSON.stringify(next));
    } catch {
      /* storage unavailable: the filter lasts for this visit */
    }
  }, [filterKey]);

  // The active sheet's computed values by position, for sort, filter and charts.
  const valueMap = useMemo(() => {
    const m = new Map<string, { raw: string; format: string; computed: string }>();
    for (const c of ss.cells) {
      if (c.sheet_id === activeSheetId) m.set(`${c.row}-${c.col}`, { raw: c.raw_value, format: c.format, computed: c.computed_value });
    }
    return m;
  }, [ss.cells, activeSheetId]);
  const cellAt = useCallback((r: number, c: number) => valueMap.get(`${r}-${c}`) ?? null, [valueMap]);
  const valueAt = useCallback((r: number, c: number) => valueMap.get(`${r}-${c}`)?.computed ?? '', [valueMap]);
  const activeFilter = activeSheetId ? filters[activeSheetId] ?? null : null;
  const hidden = useMemo(() => hiddenRows(activeFilter, valueAt), [activeFilter, valueAt]);
  const filterHeader = useMemo(() => (activeFilter
    ? {
      row: activeFilter.rect.top, left: activeFilter.rect.left, right: activeFilter.rect.right,
      active: new Set(Object.keys(activeFilter.columns).map(Number)),
    }
    : null), [activeFilter]);

  // The choice list closes on any click elsewhere, or when the selection moves.
  useEffect(() => {
    if (!pick) return;
    const close = () => setPick(null);
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [pick]);
  useEffect(() => setPick(null), [selectedCell, activeSheetId]);

  // Shift+F2 / "Note…": open a cell's note.
  const { idsOf, loadNote, editNote } = ss;
  const openNote = useCallback(
    (row: number, col: number) => {
      const ids = activeSheetId ? idsOf(activeSheetId, row, col) : null;
      if (activeSheetId && ids) setNoteCell({ sheetId: activeSheetId, rowId: ids.row_id, colId: ids.col_id });
    },
    [activeSheetId, idsOf],
  );
  const loadOpenNote = useCallback(
    () => (noteCell ? loadNote(noteCell.sheetId, noteCell.rowId, noteCell.colId) : Promise.resolve([])),
    [noteCell, loadNote],
  );
  const editOpenNote = useCallback(
    (ops: NoteOp[]) => (noteCell ? editNote(noteCell.sheetId, noteCell.rowId, noteCell.colId, ops) : Promise.resolve()),
    [noteCell, editNote],
  );

  // Commit + move (Enter = down, Tab = right)
  const handleCommitAndMove = useCallback(
    async (direction: 'down' | 'right' | 'none') => {
      const write = commitCellRef.current?.();
      if (selectedCell) {
        const { row, col } = selectedCell;
        if (direction === 'down' && row < GRID_ROWS - 1) setSelectedCell({ row: row + 1, col });
        else if (direction === 'right' && col < GRID_COLS - 1) setSelectedCell({ row, col: col + 1 });
      }
      await write;
    },
    [selectedCell],
  );

  // ── Formula bar ─────────────────────────────────────────────────
  const handleFormulaChange = useCallback((v: string) => {
    setFormulaInput(v);
    setIsDirty(true);
    setEditing(true);
    ensureEditAnchor();
    // Typing breaks the point-mode replace chain — the next clicked ref should
    // insert at the caret, not replace the previously-inserted one.
    autoRefRef.current = undefined;
  }, [ensureEditAnchor]);

  // Clicking into the formula bar begins editing (so a subsequent cell click
  // inserts a reference rather than navigating).
  const handleBeginEdit = useCallback(() => {
    setEditing(true);
    ensureEditAnchor();
  }, [ensureEditAnchor]);

  const handleFormulaCommit = useCallback(async () => {
    const home = editAnchor;
    const write = commitCellRef.current?.();
    // If we wandered onto another sheet to point-pick, snap back to the home
    // sheet so the committed cell and the post-commit "move down" are visible.
    if (home && home.sheetId !== activeSheetId) setActiveSheetId(home.sheetId);
    // Move down now, not once the node answers: a late move would pull the
    // selection away from a cell the user has since clicked and started typing in.
    setSelectedCell((prev) =>
      prev && prev.row < GRID_ROWS - 1 ? { row: prev.row + 1, col: prev.col } : prev,
    );
    setSelectionRange(null);
    await write;
  }, [editAnchor, activeSheetId]);

  const handleFormulaCancel = useCallback(() => {
    const home = editAnchor;
    setEditing(false);
    setEditAnchor(null);
    autoRefRef.current = undefined;
    if (home && home.sheetId !== activeSheetId) setActiveSheetId(home.sheetId);
    // Revert to stored value at the home cell
    const sheetId = home?.sheetId ?? activeSheetId;
    if (!selectedCell || !sheetId) return;
    const cell = ss.cells.find(
      (c) =>
        c.sheet_id === sheetId &&
        c.row === selectedCell.row &&
        c.col === selectedCell.col,
    );
    setFormulaInput(idsToNames(cell?.raw_value ?? '', idToName));
    setIsDirty(false);
  }, [editAnchor, selectedCell, activeSheetId, ss.cells, idToName]);

  // Insert a cell/range reference into the formula at the caret (point mode).
  const insertRef = useCallback(
    (ref: string) => {
      const el = formulaInputRef.current;
      const cur = formulaInput;
      const selStart = el?.selectionStart ?? cur.length;
      const selEnd = el?.selectionEnd ?? selStart;
      // When point-picking on a sheet other than the formula's home, qualify the
      // reference with that sheet's name (`Data!A1`, `'Q3 Budget'!B2:C4`).
      const qualified = pickingForeignSheet
        ? `${sheetPrefix(ss.sheets.find((s) => s.id === activeSheetId)?.name ?? '')}${ref}`
        : ref;
      const res = insertReference(
        { text: cur, selStart, selEnd, autoRef: autoRefRef.current },
        qualified,
      );
      autoRefRef.current = res.autoRef;
      setFormulaInput(res.text);
      setIsDirty(true);
      setEditing(true);
      // Restore focus and place the caret just after the inserted reference so
      // the user can keep typing (e.g. an operator, or `)`).
      requestAnimationFrame(() => {
        const e2 = formulaInputRef.current;
        if (e2) {
          e2.focus();
          e2.setSelectionRange(res.caret, res.caret);
        }
      });
    },
    [formulaInput, pickingForeignSheet, ss.sheets, activeSheetId],
  );

  // ── Sheet management ────────────────────────────────────────────
  const handleAddSheet = useCallback(async () => {
    const name = `Sheet ${ss.sheets.length + 1}`;
    await ss.createSheet(name);
  }, [ss]);

  const handleSelectSheet = useCallback(
    async (id: string) => {
      // While editing a formula, switching tabs is a point-pick move: keep the
      // edit (formula text, home anchor, formula-bar focus) and just view the
      // other sheet so its cells can be clicked in as `Sheet!A1` references.
      if (pointMode) {
        ensureEditAnchor();
        setActiveSheetId(id);
        setSelectionRange(null);
        requestAnimationFrame(() => formulaInputRef.current?.focus());
        return;
      }
      const write = isDirty ? commitCellRef.current?.() : undefined;
      setActiveSheetId(id);
      setSelectedCell(null);
      setSelectionRange(null);
      setFormulaInput('');
      setIsDirty(false);
      setEditing(false);
      setEditAnchor(null);
      autoRefRef.current = undefined;
      await write;
    },
    [isDirty, pointMode, ensureEditAnchor],
  );

  // Right-click a cell: if it's outside the current selection, select just it;
  // then open the Format menu at the cursor.
  const handleCellContextMenu = useCallback(
    (row: number, col: number, x: number, y: number) => {
      const inSel =
        selectionRange &&
        row >= selectionRange.top && row <= selectionRange.bottom &&
        col >= selectionRange.left && col <= selectionRange.right;
      if (!inSel) {
        setSelectedCell({ row, col });
        setSelectionRange(null);
        setEditing(false);
      }
      setCtxMenu({ x, y });
    },
    [selectionRange],
  );

  // Apply a format keyword to every cell in the current selection (or the
  // single selected cell), then close the menu.
  const applyFormat = useCallback(
    async (format: string) => {
      setCtxMenu(null);
      if (!activeSheetId) return;
      const rect =
        selectionRange ??
        (selectedCell
          ? { top: selectedCell.row, left: selectedCell.col, bottom: selectedCell.row, right: selectedCell.col }
          : null);
      if (!rect) return;
      const ops: CellOp[] = [];
      for (let r = rect.top; r <= rect.bottom; r++) {
        for (let c = rect.left; c <= rect.right; c++) {
          ops.push(formatOp(r, c, format));
        }
      }
      await ss.applyCellOps(activeSheetId, ops);
    },
    [activeSheetId, selectionRange, selectedCell, ss],
  );

  // ── Rows, columns and names ─────────────────────────────────────
  // The rect the menu acts on: the multi-cell selection, or the selected cell.
  const menuRect = (): Rect | null =>
    selectionRange ??
    (selectedCell
      ? { top: selectedCell.row, left: selectedCell.col, bottom: selectedCell.row, right: selectedCell.col }
      : null);

  // The range sort and filter act on: the selection, or the block of data
  // around the selected cell.
  const dataRect = (): Rect | null => {
    if (selectionRange) return selectionRange;
    if (!selectedCell) return null;
    return dataRegion(selectedCell, GRID_ROWS, GRID_COLS, (r, c) => valueMap.has(`${r}-${c}`));
  };
  const sortBy = async (ascending: boolean) => {
    setCtxMenu(null);
    const rect = dataRect();
    if (!activeSheetId || !rect || !selectedCell) return;
    const key = Math.max(rect.left, Math.min(rect.right, selectedCell.col));
    const header = looksLikeHeader(rect, key, cellAt);
    const order = sortOrder(rect, key, ascending, header, cellAt);
    const first = rect.top + (header ? 1 : 0);
    const writes = planSort(rect, key, ascending, header, cellAt);
    const ops: CellOp[] = writes.flatMap((w) => (w.raw === ''
      ? [clearOp(w.row, w.col)]
      : [setOp(w.row, w.col, w.raw), formatOp(w.row, w.col, w.format)]));
    if (ops.length > 0) await ss.applyCellOps(activeSheetId, ops);
    // Styles travel with their rows.
    await ss.moveStyles(activeSheetId, { ...rect, top: first }, (row) => order[row - first] ?? row);
  };

  // Each is one write per row or column: cells keep their ids, and formulas
  // that reference them keep pointing at the same cells.
  const structural = (fn: (sheetId: string, rect: Rect) => Promise<void>) => () => {
    setCtxMenu(null);
    const rect = menuRect();
    if (!activeSheetId || !rect) return;
    setSelectionRange(null);
    void fn(activeSheetId, rect).catch((err: unknown) => console.error('[sheets] structural edit failed', err));
  };
  const rows = (r: Rect) => r.bottom - r.top + 1;
  const cols = (r: Rect) => r.right - r.left + 1;
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const menuSections = (() => {
    const r = menuRect();
    // A private sheet has fixed rows and columns, and nothing to share.
    if (!r || isPrivateActive || activeLinkedFrom) return [];
    const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
    return [
      {
        label: 'Rows',
        actions: [
          { label: `Insert ${plural(rows(r), 'row')} above`, testId: 'insert-rows-above',
            onClick: structural((sid, x) => ss.insertAxis(sid, 'row', x.top, rows(x))) },
          { label: `Insert ${plural(rows(r), 'row')} below`, testId: 'insert-rows-below',
            onClick: structural((sid, x) => ss.insertAxis(sid, 'row', x.bottom + 1, rows(x))) },
          { label: `Delete ${plural(rows(r), 'row')}`, testId: 'delete-rows',
            onClick: structural((sid, x) => ss.deleteAxis(sid, 'row', range(x.top, x.bottom))) },
        ],
      },
      {
        label: 'Columns',
        actions: [
          { label: `Insert ${plural(cols(r), 'column')} left`, testId: 'insert-cols-left',
            onClick: structural((sid, x) => ss.insertAxis(sid, 'col', x.left, cols(x))) },
          { label: `Insert ${plural(cols(r), 'column')} right`, testId: 'insert-cols-right',
            onClick: structural((sid, x) => ss.insertAxis(sid, 'col', x.right + 1, cols(x))) },
          { label: `Delete ${plural(cols(r), 'column')}`, testId: 'delete-cols',
            onClick: structural((sid, x) => ss.deleteAxis(sid, 'col', range(x.left, x.right))) },
        ],
      },
      {
        label: 'Comment',
        actions: [
          { label: 'Comment…', testId: 'open-comments',
            onClick: () => { setCtxMenu(null); setShowComments(true); } },
          { label: 'Files…', testId: 'open-files',
            onClick: () => { setCtxMenu(null); setShowFiles(true); } },
          { label: 'Note… (Shift+F2)', testId: 'open-note',
            onClick: () => { setCtxMenu(null); if (selectedCell) openNote(selectedCell.row, selectedCell.col); } },
        ],
      },
      ...(canResize ? [{
        label: 'Sort',
        actions: [
          { label: `Sort A → Z by column ${columnLabel(selectedCell?.col ?? r.left)}`, testId: 'sort-asc', onClick: () => void sortBy(true) },
          { label: `Sort Z → A by column ${columnLabel(selectedCell?.col ?? r.left)}`, testId: 'sort-desc', onClick: () => void sortBy(false) },
        ],
      }] : []),
      {
        label: 'View',
        actions: [
          activeFilter
            ? { label: 'Remove my filter', testId: 'filter-remove', onClick: () => {
              setCtxMenu(null);
              if (!activeSheetId) return;
              const next = { ...filters };
              delete next[activeSheetId];
              saveFilters(next);
            } }
            : { label: 'Filter (just for me)', testId: 'filter-create', onClick: () => {
              setCtxMenu(null);
              const rect = dataRect();
              if (activeSheetId && rect) saveFilters({ ...filters, [activeSheetId]: { rect, columns: {} } });
            } },
          { label: 'Chart this range…', testId: 'open-charts', onClick: () => { setCtxMenu(null); setShowCharts(true); } },
          { label: 'Link to another workbook…', testId: 'open-links', onClick: () => { setCtxMenu(null); setShowLinks(true); } },
          ...(canResize ? [{ label: 'Alert when…', testId: 'open-alerts',
            onClick: () => { setCtxMenu(null); setRulesError(null); setRulesMode('alert'); } }] : []),
        ],
      },
      ...(canResize ? [{
        label: 'Freeze',
        actions: [
          { label: `Freeze up to row ${r.bottom + 1}`, testId: 'freeze-rows',
            onClick: () => { setCtxMenu(null); if (activeSheetId) void setFrozen(activeSheetId, r.bottom + 1, activeView.frozenCols); } },
          { label: `Freeze up to column ${columnLabel(r.right)}`, testId: 'freeze-cols',
            onClick: () => { setCtxMenu(null); if (activeSheetId) void setFrozen(activeSheetId, activeView.frozenRows, r.right + 1); } },
          ...(activeView.frozenRows || activeView.frozenCols ? [{ label: 'Unfreeze', testId: 'unfreeze',
            onClick: () => { setCtxMenu(null); if (activeSheetId) void setFrozen(activeSheetId, 0, 0); } }] : []),
        ],
      }] : []),
      ...(isOwner ? [{
        label: 'Protect',
        actions: [
          { label: 'Protect range…', testId: 'open-protect',
            onClick: () => { setCtxMenu(null); setProtectError(null); setShowProtect(true); } },
        ],
      }] : []),
      {
        label: 'Name',
        actions: [
          { label: 'Name this range…', testId: 'open-names',
            onClick: () => { setCtxMenu(null); setNamesError(null); setShowNames(true); } },
        ],
      },
    ];
  })();

  const namesSelection = (() => {
    const r = menuRect();
    if (!r || !activeSheetId) return null;
    const name = idToName(activeSheetId);
    return `${name ? sheetPrefix(name) : ''}${rangeRef({ row: r.top, col: r.left }, { row: r.bottom, col: r.right })}`;
  })();

  const runRules = async (fn: () => Promise<void>) => {
    setRulesSaving(true);
    setRulesError(null);
    try {
      await fn();
    } catch (err) {
      setRulesError(describeError(err));
    } finally {
      setRulesSaving(false);
    }
  };

  const runProtect = async (fn: () => Promise<void>) => {
    setProtectSaving(true);
    setProtectError(null);
    try {
      await fn();
    } catch (err) {
      setProtectError(describeError(err));
    } finally {
      setProtectSaving(false);
    }
  };

  const runNames = async (fn: () => Promise<void>) => {
    setNamesSaving(true);
    setNamesError(null);
    try {
      await fn();
    } catch (err) {
      setNamesError(describeError(err));
    } finally {
      setNamesSaving(false);
    }
  };

  // Apply a fill drag: compute the writes from the source→target rects and
  // persist them. Empty results clear the cell; formats follow the pattern.
  const handleFill = useCallback(
    async (source: Rect, target: Rect) => {
      if (!activeSheetId) return;
      const getCell = (r: number, c: number) => {
        const cell = ss.cells.find(
          (x) => x.sheet_id === activeSheetId && x.row === r && x.col === c,
        );
        return cell ? { raw: cell.raw_value, format: cell.format } : null;
      };
      const writes = planFill(source, target, getCell);
      const ops: CellOp[] = [];
      for (const w of writes) {
        if (w.raw.trim() === '') {
          // Empty target: clear the cell (drops any value AND format).
          ops.push(clearOp(w.row, w.col));
        } else {
          ops.push(setOp(w.row, w.col, w.raw));
          // Always apply the pattern's format — including '' — so filling an
          // unformatted pattern over a previously-formatted cell clears the
          // stale format instead of leaving it behind.
          ops.push(formatOp(w.row, w.col, w.format));
        }
      }
      if (ops.length > 0) await ss.applyCellOps(activeSheetId, ops);
    },
    [activeSheetId, ss],
  );

  // The rect the clipboard/delete operate on: the multi-cell selection, or the
  // single selected cell.
  const currentRegion = useCallback((): Rect | null => {
    if (selectionRange) return selectionRange;
    if (selectedCell) {
      return { top: selectedCell.row, left: selectedCell.col, bottom: selectedCell.row, right: selectedCell.col };
    }
    return null;
  }, [selectionRange, selectedCell]);

  // Build the internal payload + TSV for a copy or cut of the current region.
  // The event originates on the grid's hidden focus-catcher textarea (see
  // SpreadsheetGrid): Chrome only fires copy/cut/paste when an editable element
  // is focused (or text is selected), so a non-editable grid div never receives
  // them — the catcher is the element that makes these events fire at all.
  const buildClip = useCallback(
    (cut: boolean, e: React.ClipboardEvent) => {
      if (editing || !activeSheetId || !e.clipboardData) return;
      const region = currentRegion();
      if (!region) return;
      e.preventDefault();
      const at = (r: number, c: number) =>
        ss.cells.find((x) => x.sheet_id === activeSheetId && x.row === r && x.col === c);
      // TSV of computed values (for external apps), row-major over the rect.
      const values: string[][] = [];
      for (let r = region.top; r <= region.bottom; r++) {
        const rowVals: string[] = [];
        for (let c = region.left; c <= region.right; c++) rowVals.push(at(r, c)?.computed_value ?? '');
        values.push(rowVals);
      }
      const tsv = toTSV(values);
      // Internal cells (raw + format), offsets from the region top-left. Empty
      // source cells are included so a paste clears the matching target cell.
      const cells: ClipCell[] = rectCells(region).map(({ row, col }) => {
        const cell = at(row, col);
        return {
          dr: row - region.top,
          dc: col - region.left,
          raw: cell?.raw_value ?? '',
          format: cell?.format ?? '',
        };
      });
      e.clipboardData.setData('text/plain', tsv);
      setClipboard({
        cells,
        rows: region.bottom - region.top + 1,
        cols: region.right - region.left + 1,
        cut,
        sourceRect: region,
        sourceSheetId: activeSheetId,
        tsv,
      });
    },
    [editing, activeSheetId, currentRegion, ss.cells],
  );

  const handleCopy = useCallback((e: React.ClipboardEvent) => buildClip(false, e), [buildClip]);
  const handleCut = useCallback((e: React.ClipboardEvent) => buildClip(true, e), [buildClip]);

  const handlePaste = useCallback(
    async (e: React.ClipboardEvent) => {
      if (editing || !activeSheetId || !e.clipboardData) return;
      const region = currentRegion();
      if (!region) return;
      e.preventDefault();
      const anchor = { row: region.top, col: region.left };
      // Normalize CRLF — Windows clipboards round-trip text/plain as \r\n, so
      // without this an internal multi-row copy would fail self-detection and
      // fall through to the values-only external path.
      const text = e.clipboardData.getData('text/plain').replace(/\r\n/g, '\n');
      const internal = !!clipboard && text === clipboard.tsv;

      // For a cut, clear the source FIRST: the writes come from the in-memory
      // payload (not re-read from live cells), so clearing first means an
      // overlapping paste target isn't wiped by a later source-clear.
      const cutClears: CellOp[] =
        internal && clipboard!.cut
          ? [...rectCells(clipboard!.sourceRect)].map(({ row, col }) => clearOp(row, col))
          : [];

      // A copy pasted onto a DIFFERENT sheet qualifies its formulas to the
      // source sheet (=SUM(A9:F9) → =SUM(Sheet1!A9:F9)) instead of shifting refs
      // by the meaningless cross-sheet positional delta. Same-sheet → shift.
      const crossSheet =
        internal && clipboard!.sourceSheetId !== activeSheetId
          ? { sourceSheetId: clipboard!.sourceSheetId }
          : null;

      const writes: PasteWrite[] = internal
        ? planPaste(clipboard!, anchor, crossSheet)
        : // External TSV → raw values, anchored at the selection top-left.
          fromTSV(text).flatMap((rowVals, r) =>
            rowVals.map((v, c) => ({ row: anchor.row + r, col: anchor.col + c, raw: v, format: '' })),
          );

      const pasteOps: CellOp[] = [];
      for (const w of writes) {
        if (w.row < 0 || w.row >= GRID_ROWS || w.col < 0 || w.col >= GRID_COLS) continue; // clip
        if (w.raw.trim() === '') {
          pasteOps.push(clearOp(w.row, w.col));
        } else {
          pasteOps.push(setOp(w.row, w.col, w.raw));
          // Only apply a non-empty format. A plain copy carries "", and applying
          // an empty format is a pointless second mutation on the cell.
          if (w.format) {
            pasteOps.push(formatOp(w.row, w.col, w.format));
          }
        }
      }

      const ops = [...cutClears, ...pasteOps];
      if (ops.length > 0) await ss.applyCellOps(activeSheetId, ops);

      if (internal && clipboard!.cut) setClipboard(null); // consumed cut empties the clipboard
    },
    [editing, activeSheetId, currentRegion, clipboard, ss],
  );

  const handleDelete = useCallback(async () => {
    if (editing || !activeSheetId) return;
    const region = currentRegion();
    if (!region) return;
    const cells = [...rectCells(region)];
    if (cells.length === 1) {
      // Single-cell delete stays on the direct clearCell path.
      await ss.clearCell(activeSheetId, cells[0].row, cells[0].col);
      return;
    }
    const ops = cells.map(({ row, col }) => clearOp(row, col));
    await ss.applyCellOps(activeSheetId, ops);
  }, [editing, activeSheetId, currentRegion, ss]);

  const handleClearClipboard = useCallback(() => setClipboard(null), []);

  // Format of the anchor cell, to check-mark the active option in the menu.
  const activeCellFormat =
    (selectedCell && activeSheetId
      ? ss.cells.find(
          (c) => c.sheet_id === activeSheetId && c.row === selectedCell.row && c.col === selectedCell.col,
        )?.format
      : '') ?? '';

  // ── Download ────────────────────────────────────────────────────
  /** A file name from the spreadsheet's name, safe for any file system. */
  const workbookName = ss.project?.name;
  const fileTitle = useCallback(() => (workbookName?.trim() || APP_DISPLAY_NAME)
    .replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, '-').toLowerCase(), [workbookName]);

  const handleDownload = useCallback(async () => {
    // Fetch every sheet's cells on demand — resident `cells` holds only the
    // active sheet, so a full snapshot must be pulled at export time.
    const sheetData = await Promise.all(
      ss.sheets.map(async (sheet) => ({
        name: sheet.name,
        cells: await ss.getSheetCells(sheet.id),
      })),
    );
    const blob = new Blob([sheetsToCsv(sheetData)], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    // The spreadsheet's own name, not the app's. Every export from every
    // project used to land in Downloads as `mero-sheets.csv`, so the second one
    // was `mero-sheets (1).csv` and neither file said what it held.
    a.download = `${fileTitle()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [ss, fileTitle]);

  // Every shared sheet, formulas with sheet names, for Excel.
  const handleDownloadXlsx = useCallback(async () => {
    const sheets: BookSheet[] = await Promise.all(ss.sheets.map(async (sheet) => ({
      name: sheet.name,
      cells: (await ss.getSheetCells(sheet.id)).map((c) => ({
        row: c.row, col: c.col,
        raw: idsToNames(c.raw_value, idToName),
        computed: c.computed_value,
      })),
    })));
    const blob = new Blob([writeXlsx(sheets)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${fileTitle()}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  }, [ss, idToName, fileTitle]);

  // An .xlsx (every sheet) or a CSV/TSV (one sheet) becomes new sheets.
  const handleImport = useCallback(async (file: File) => {
    setImporting(`Reading ${file.name}…`);
    try {
      const book: BookSheet[] = /\.xlsx$/i.test(file.name)
        ? readXlsx(new Uint8Array(await file.arrayBuffer()))
        : [{
          name: file.name.replace(/\.[^.]+$/, '') || 'Imported',
          cells: parseCsv(await file.text()).flatMap((row, r) => row.map((raw, c) => ({ row: r, col: c, raw }))),
        }];
      // Make the sheets first, so formulas can name any of them.
      const ids: string[] = [];
      for (const [i, sheet] of book.entries()) {
        setImporting(`Creating sheet ${i + 1} of ${book.length}…`);
        const id = await ss.createSheet(sheet.name);
        if (!id) throw new Error('Could not create a sheet');
        ids.push(id);
      }
      const byName = new Map(book.map((sh, i) => [sh.name, ids[i]]));
      const resolve = (name: string) => byName.get(name) ?? nameToId(name);
      let clipped = 0;
      for (const [i, sheet] of book.entries()) {
        setImporting(`Writing sheet ${i + 1} of ${book.length}…`);
        const ops: CellOp[] = [];
        for (const c of sheet.cells) {
          if (c.row >= GRID_ROWS || c.col >= GRID_COLS) { clipped++; continue; }
          if (c.raw.trim() === '') continue;
          ops.push(setOp(c.row, c.col, c.raw.startsWith('=') ? namesToIds(c.raw, resolve) : c.raw));
        }
        if (ops.length > 0) await ss.applyCellOps(ids[i], ops);
      }
      setActiveSheetId(ids[0] ?? activeSheetId);
      setImporting(clipped > 0 ? `Imported. ${clipped} cells past row ${GRID_ROWS} or column ZZ were left out.` : null);
    } catch (err) {
      setImporting(`Import failed: ${describeError(err)}`);
    }
  }, [ss, nameToId, activeSheetId]);

  // ════════════════════════════════════════════════════════════════
  //  RENDER
  // ════════════════════════════════════════════════════════════════

  // The account controls every screen carries in its top bar: the light/dark
  // switch and Log out.
  const accountControls = (
    <>
      <ThemeToggle />
      <LogoutBtn type="button" onClick={signOut} aria-label="Log out" title="Log out of your node" data-testid="action-logout">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
          <polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" />
        </svg>
        <span>Log out</span>
      </LogoutBtn>
    </>
  );

  // 1. Workspace picker — shown whenever no workspace is open. Lists every
  //    workspace on this node and lets you open, create, or join one.
  if (!ws.contextId) {
    // While a reload decides whether to reopen the last spreadsheet, the list
    // stays hidden: showing it for a moment and then leaving reads as a glitch.
    const listLoading = (ws.loading && ws.workspaces.length === 0) || ws.resuming;
    return (
      <PickerShell>
        <TopBar>
          <AppMark aria-hidden="true"><SheetGlyph size={18} /></AppMark>
          <TitleBlock>
            <TitleName>{APP_DISPLAY_NAME}</TitleName>
            <TitleMeta>Spreadsheets on your node</TitleMeta>
          </TitleBlock>
          <TopSpacer />
          {accountControls}
        </TopBar>

        <PickerMain>
          <PickerHero>
            <Eyebrow>Workspace</Eyebrow>
            <h1>{ws.namespaceName}</h1>
            <p>
              Open a spreadsheet or create a new one. To join someone else&rsquo;s,
              open the invitation link they sent you. All data lives on your node —
              no central server.
            </p>
          </PickerHero>

          <PickerGrid>
            <Card as="section" aria-labelledby="sheets-heading">
              <CardHead>
                <h2 id="sheets-heading">Spreadsheets</h2>
                {ws.workspaces.length > 0 && <CountPill>{ws.workspaces.length}</CountPill>}
              </CardHead>

              {ws.workspaces.length > 0 && !ws.resuming && (
                <WorkspaceList aria-label={`Spreadsheets in ${ws.namespaceName}`}>
                  {ws.workspaces.map((w) => (
                    <WorkspaceRow
                      key={w.contextId}
                      data-testid="workspace-item"
                      onClick={() => ws.openWorkspace(w.contextId)}
                      title={`Open ${w.name}`}
                    >
                      <RowIcon aria-hidden="true"><SheetGlyph size={18} /></RowIcon>
                      <WorkspaceMeta>
                        {/* An unnamed row is styled as the placeholder it is rather
                            than passed off as a title someone chose. */}
                        <WorkspaceName $placeholder={w.unnamed}>{w.name}</WorkspaceName>
                        <WorkspaceId>{w.contextId.slice(0, 10)}…</WorkspaceId>
                      </WorkspaceMeta>
                      <OpenChevron aria-hidden="true">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M5 12h14M13 6l6 6-6 6" />
                        </svg>
                      </OpenChevron>
                    </WorkspaceRow>
                  ))}
                </WorkspaceList>
              )}

              {/* Joined, but this workspace's spreadsheets have not replicated yet.
                  Without this the list above is empty and reads as "there is
                  nothing here" rather than "it is on its way". */}
              {ws.isSyncing && (
                <div style={{ margin: '4px 0 12px' }}>
                  <JoinSyncBanner
                    show
                    what="spreadsheets"
                    onDismiss={ws.dismissSyncing}
                  />
                </div>
              )}
              {listLoading && !ws.isSyncing && !ws.namespacesFailed && <StatusLine>Loading spreadsheets…</StatusLine>}
              {ws.namespacesFailed && ws.workspaces.length === 0 && (
                <ErrLine data-testid="workspaces-failed">
                  Your spreadsheets could not be loaded. Try again before creating one.{' '}
                  <SecondaryBtn type="button" onClick={ws.retryNamespaces} data-testid="action-retry-workspaces">
                    Try again
                  </SecondaryBtn>
                </ErrLine>
              )}
              {!listLoading && !ws.isSyncing && !ws.namespacesFailed && ws.workspaces.length === 0 && (
                <EmptyList>
                  <RowIcon aria-hidden="true"><SheetGlyph size={20} /></RowIcon>
                  <strong>No spreadsheets yet</strong>
                  <span>Create the first one, or open an invitation link someone sent you.</span>
                </EmptyList>
              )}
              {ws.notInstalled && (
                <ErrLine>
                  This app is not installed on your node, so it has nowhere to keep a
                  spreadsheet. Install it from the registry and reload.
                </ErrLine>
              )}
            </Card>

            <Card as="section" aria-labelledby="new-heading">
              <CardHead>
                <h2 id="new-heading">New spreadsheet</h2>
              </CardHead>
              <FieldLabel htmlFor="project-name">Name</FieldLabel>
              <ProjectNameInput
                id="project-name"
                data-testid="field-name"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                placeholder="e.g. Q3 Budget, Team OKRs…"
              />

              <ButtonRow>
                <PrimaryBtn
                  data-testid="action-init_project"
                  disabled={!projectName.trim() || !ws.canCreate}
                  onClick={() => void ws.createWorkspace(projectName.trim())}
                >
                  Create spreadsheet
                </PrimaryBtn>
              </ButtonRow>

              {ws.status && <StatusLine>{ws.status}</StatusLine>}
              {ws.error && <ErrLine>{describeError(ws.error)}</ErrLine>}
            </Card>
          </PickerGrid>
        </PickerMain>

      </PickerShell>
    );
  }

  // 2. A workspace is opening — its context identity is still resolving.
  if (!ws.ready) {
    return (
      <PickerShell>
        <TopBar>
          <AppMark aria-hidden="true"><SheetGlyph size={18} /></AppMark>
          <TitleBlock>
            <TitleName>{APP_DISPLAY_NAME}</TitleName>
            <TitleMeta>Spreadsheets on your node</TitleMeta>
          </TitleBlock>
          <TopSpacer />
          {accountControls}
        </TopBar>
        <OpeningWrap>
          <Card>
            {!ws.error && <Spinner aria-hidden="true" />}
            <h2>Opening {ws.activeName}…</h2>
            {/* This screen used to say "Resolving your identity" and wait forever
                for an identity that, for anyone who joined by invitation, was
                never coming. It now names each step, and a failure ends here
                instead of in a spinner. */}
            <p>{ws.status ?? 'Getting you into this spreadsheet.'}</p>
            {ws.error && <ErrLine>{describeError(ws.error)}</ErrLine>}
            <SecondaryBtn onClick={ws.leaveWorkspace}>← Back to spreadsheets</SecondaryBtn>
          </Card>
        </OpeningWrap>
      </PickerShell>
    );
  }

  // 3. Full spreadsheet view
  const selRef = selectedCell ? cellRef(selectedCell.row, selectedCell.col) : null;
  // The contract's own title first — it is the one every peer sees. The picker's
  // name (from the replicated context metadata) covers the window before
  // `init_project` lands, and only then a placeholder.
  const activeWorkspaceName = ss.project?.name?.trim() || ws.activeName;
  const roster = labelsById(labelMembers(withNamespaceNames(ss.members, namespaceNameOf), ss.selfId));
  // `ss.selfId` — the id the CONTRACT writes under — and NOT
  // `ws.executorPublicKey`, which is a context identity. Both are 64 hex, so the
  // old comparison type-checked, never matched, and rendered the local user as a
  // stranger in their own spreadsheet.
  const collaborators = distinctCollaborators(presence.cursors, ss.selfId, C.green, roster);
  const peers = peerCount(presence.cursors, ss.selfId);
  const cursorLabel = (author: string) => avatarLabel(roster.get(author)?.label ?? author);
  const personName = (memberId: string) =>
    memberId === ss.selfId ? 'You' : roster.get(memberId)?.label ?? namespaceDisplayName(memberId);
  const editedBy = (c: { last_editor: string; last_edited_at: number }) =>
    c.last_editor ? `Edited by ${personName(c.last_editor)}, ${ago(nsToMs(c.last_edited_at))}` : null;
  const connected = ss.ready && ss.loaded;

  // Comments: the selected cell's ids, open threads on this sheet (grid
  // marks), and where a comment lives for the panel's jump links.
  const selectedIds = activeSheetId && selectedCell ? ss.idsOf(activeSheetId, selectedCell.row, selectedCell.col) : null;
  const openComments = ss.comments.filter((c) => !c.parent && !c.resolved);
  const commented = new Set(
    openComments
      .filter((c) => c.sheet_id === activeSheetId)
      .map((c) => ss.refOf(c.sheet_id, c.row_id, c.col_id))
      .filter((at): at is CellCoord => at !== null)
      .map((at) => `${at.row}-${at.col}`),
  );
  const commentWhere = (c: { sheet_id: string; row_id: string; col_id: string }) => {
    const at = ss.refOf(c.sheet_id, c.row_id, c.col_id);
    if (!at) return null;
    const name = c.sheet_id === activeSheetId ? null : idToName(c.sheet_id);
    return `${name ? sheetPrefix(name) : ''}${cellRef(at.row, at.col)}`;
  };
  const jumpTo = (sheetId: string, rowId: string, colId: string) => {
    const at = ss.refOf(sheetId, rowId, colId);
    if (!at) return false;
    setActiveSheetId(sheetId);
    setSelectedCell(at);
    setSelectionRange(null);
    return true;
  };
  const notes = new Map<string, string>();
  for (const n of ss.notedCells) {
    if (n.sheet_id !== activeSheetId) continue;
    const at = ss.refOf(n.sheet_id, n.row_id, n.col_id);
    if (at) notes.set(`${at.row}-${at.col}`, n.preview);
  }
  const noteLabel = noteCell ? commentWhere({ sheet_id: noteCell.sheetId, row_id: noteCell.rowId, col_id: noteCell.colId }) : null;

  const attached = new Set(
    ss.attachments
      .filter((a) => a.sheet_id === activeSheetId)
      .map((a) => ss.refOf(a.sheet_id, a.row_id, a.col_id))
      .filter((at): at is CellCoord => at !== null)
      .map((at) => `${at.row}-${at.col}`),
  );
  const mention = ss.mentions[ss.mentions.length - 1];
  const mentionComment = mention ? ss.comments.find((c) => c.id === mention.commentId) : undefined;

  return (
    <AppShell>
      {/* ── Top bar: where you are, who is here, and your account ───── */}
      <TopBar>
        <BackBtn
          onClick={async () => { if (isDirty) await commitCellRef.current?.(); ws.leaveWorkspace(); }}
          title="Back to spreadsheets"
          aria-label="Back to spreadsheets"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M19 12H5M11 18l-6-6 6-6" />
          </svg>
        </BackBtn>
        <AppMark aria-hidden="true" $hideOnPhone><SheetGlyph size={18} /></AppMark>
        <TitleBlock>
          <TitleName>{activeWorkspaceName}</TitleName>
          <TitleMeta>
            <span>your node</span>
            <LivePill $on={connected} title={connected ? 'Live' : 'Offline'}>
              <span aria-hidden="true" />{connected ? 'live' : 'offline'}
            </LivePill>
          </TitleMeta>
        </TitleBlock>

        <TopSpacer />

        <Avatars aria-label={`${collaborators.length} collaborators`}>
          {collaborators.map((c) => (
            <Avatar
              key={c.author}
              style={{ background: c.color }}
              $self={c.isSelf}
              // The name, not the 64-hex key. An unnamed peer says so in words
              // rather than presenting a truncated id as if it were a name.
              title={
                c.isSelf
                  ? `You · ${c.name}`
                  : c.anonymous
                    ? namespaceNameOf(c.author) ?? `Has not chosen a name yet (${c.author.slice(0, 12)}…)`
                    : c.name
              }
              data-testid="collaborator-avatar"
            >
              {c.label}
            </Avatar>
          ))}
        </Avatars>
        <CollabCount title={collaborators.map((c) => (c.isSelf ? 'You' : c.name)).join(', ')}>
          {collaborators.length} collaborator{collaborators.length === 1 ? '' : 's'}
        </CollabCount>

        <PrimaryAction onClick={() => void openInvite()} aria-label="Invite collaborators">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <line x1="19" y1="8" x2="19" y2="14" /><line x1="22" y1="11" x2="16" y2="11" />
          </svg>
          <span>Invite</span>
        </PrimaryAction>

        {accountControls}
      </TopBar>

      {/* ── Tool dock: file, history and the side panels ─────────────── */}
      <ToolDock role="toolbar" aria-label="Spreadsheet tools">
        <ToolGroup>
          <ToolBtn
            data-testid="action-export_all"
            onClick={handleDownload}
            title="Download as CSV"
            aria-label="Download spreadsheet as CSV"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            <span>Download</span>
          </ToolBtn>
          <IconBtn onClick={() => void handleDownloadXlsx()} title="Download as Excel (.xlsx)" aria-label="Download spreadsheet as Excel" data-testid="action-export_xlsx">
            <XlsxTag>XLSX</XlsxTag>
          </IconBtn>
          <ToolBtn onClick={() => importInput.current?.click()} title="Import a .xlsx, .csv or .tsv file as new sheets" aria-label="Import a file" data-testid="action-import">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            <span>Import</span>
          </ToolBtn>
          <input
            ref={importInput}
            type="file"
            accept=".xlsx,.csv,.tsv,.txt"
            hidden
            data-testid="field-import"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void handleImport(f);
            }}
          />
        </ToolGroup>

        <ToolGroup>
          <IconBtn onClick={() => void ss.undo()} disabled={!ss.canUndo} title="Undo your last edit (Ctrl/⌘+Z)" aria-label="Undo" data-testid="action-undo">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 14 4 9l5-5" /><path d="M4 9h11a5 5 0 0 1 0 10h-4" />
            </svg>
          </IconBtn>
          <IconBtn onClick={() => void ss.redo()} disabled={!ss.canRedo} title="Redo (Ctrl/⌘+Shift+Z)" aria-label="Redo" data-testid="action-redo">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m15 14 5-5-5-5" /><path d="M20 9H9a5 5 0 0 0 0 10h4" />
            </svg>
          </IconBtn>
        </ToolGroup>

        <DockSpacer />

        <ToolGroup>
          <ToolBtn onClick={() => setShowPeople(true)} title="Who can do what" aria-label="Open people" data-testid="action-people">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
            <span>People</span>
          </ToolBtn>
          <ToolBtn onClick={() => setShowComments(true)} title="Comments on cells" aria-label="Open comments" data-testid="action-comments">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            <span>Comments</span>
            {openComments.length > 0 && <Badge>{openComments.length}</Badge>}
          </ToolBtn>
          <ToolBtn onClick={() => setShowCharts(true)} title="Charts of this sheet" aria-label="Open charts" data-testid="action-charts">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="6" y1="20" x2="6" y2="12" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="18" y1="20" x2="18" y2="9" />
            </svg>
            <span>Charts</span>
          </ToolBtn>
          <ToolBtn onClick={() => setShowActivity(true)} title="Who changed what" aria-label="Open activity" data-testid="action-activity">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
            </svg>
            <span>Activity</span>
          </ToolBtn>
          <ToolBtn onClick={() => setShowHelp(true)} title="Function reference" aria-label="Open function reference">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" /><line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            <span>Functions</span>
          </ToolBtn>
        </ToolGroup>
      </ToolDock>

      {/* ── The sheet: one solid card, so the grid stays crisp ───────── */}
      <SheetCard>
        <FormatBar
          style={(selectedCell && cellStyles.get(`${selectedCell.row}-${selectedCell.col}`)) || {}}
          format={activeCellFormat}
          disabled={!activeSheetId || isPrivateActive || !!selectedLock}
          formatDisabled={!activeSheetId || !!selectedLock}
          onStyle={(field, value) => {
            const r = menuRect();
            if (activeSheetId && r) void ss.applyStyle(activeSheetId, r, field, value);
          }}
          onFormat={(fmt) => void applyFormat(fmt)}
          onClear={() => {
            const r = menuRect();
            if (!activeSheetId || !r) return;
            void ss.clearStyles(activeSheetId, r);
            void applyFormat('');
          }}
          onRules={(kind) => { setRulesError(null); setRulesMode(kind); }}
        />

        <FormulaRow>
          <FormulaBar
            selectedCell={selectedCell}
            value={formulaInput}
            onChange={handleFormulaChange}
            onCommit={handleFormulaCommit}
            onCancel={handleFormulaCancel}
            onBeginEdit={handleBeginEdit}
            functions={ss.functions}
            disabled={!activeSheetId}
            inputRef={formulaInputRef}
            editing={editing}
            onCopy={handleCopy}
            onCut={handleCut}
            onPaste={handlePaste}
            onGridDelete={handleDelete}
            onGridClearClipboard={handleClearClipboard}
            onGridOpenNote={() => { if (selectedCell) openNote(selectedCell.row, selectedCell.col); }}
            onGridKey={(e) => gridKeyRef.current?.(e)}
            lockedReason={selectedLock}
          />

          {/* Commit / cancel beside the formula bar (also the accessible test target) */}
          {isDirty && selectedCell && (
            <CommitBar>
              <CommitBtn
                data-testid="action-set_cell"
                onClick={handleFormulaCommit}
                aria-label={`Commit value to cell ${selRef ?? ''}`}
                title="Confirm (Enter)"
              >
                ✓
              </CommitBtn>
              <CancelCommitBtn
                data-testid="action-clear_cell"
                onClick={handleFormulaCancel}
                aria-label="Cancel edit"
                title="Cancel (Escape)"
              >
                ✗
              </CancelCommitBtn>
            </CommitBar>
          )}
        </FormulaRow>

        {/* ── Spreadsheet grid ─────────────────────────────────────── */}
        <SpreadsheetGrid
          sheetId={activeSheetId}
          cells={ss.cells}
          cursors={presence.cursors}
          cursorLabel={cursorLabel}
          editedBy={editedBy}
          commented={commented}
          attached={attached}
          notes={notes}
          protectedRanges={placed}
          view={activeView}
          cellStyles={cellStyles}
          ruleAt={ruleAt}
          onToggleCheckbox={(row, col) => {
            if (!activeSheetId || lockedReason(placed, myRole, row, col)) return;
            const current = ss.cells.find((c) => c.sheet_id === activeSheetId && c.row === row && c.col === col);
            void ss.setCell(activeSheetId, row, col, current?.computed_value.toUpperCase() === 'TRUE' ? 'FALSE' : 'TRUE');
          }}
          onPickOption={(row, col, options, anchor) => setPick({ row, col, options, x: anchor.left, y: anchor.bottom })}
          hiddenRows={hidden}
          filterHeader={filterHeader}
          onFilterColumn={setFilterCol}
          keyHandlerRef={gridKeyRef}
          onResize={canResize ? handleResize : undefined}
          selectedCell={pickingForeignSheet ? null : selectedCell}
          selectionRange={pickingForeignSheet ? null : selectionRange}
          editingValue={pickingForeignSheet ? null : isDirty ? formulaInput : null}
          pointMode={pointMode}
          onPointRef={insertRef}
          onSelectCell={handleSelectCell}
          onSelectRange={handleSelectRange}
          onSelectColumn={handleSelectColumn}
          onSelectRow={handleSelectRow}
          onEditCell={handleEditCell}
          onOpenNote={openNote}
          onCommitAndMove={handleCommitAndMove}
          onCellContextMenu={handleCellContextMenu}
          onFill={handleFill}
          onDelete={handleDelete}
          onClearClipboard={handleClearClipboard}
          copiedRegion={clipboard ? { rect: clipboard.sourceRect, cut: clipboard.cut } : null}
        />

        {/* ── Sheet tabs ───────────────────────────────────────────── */}
        <SheetTabs
          sheets={allSheets}
          privateIds={privateIds}
          onAddPrivate={() => void ss.createPrivateSheet(`Private ${ss.privateSheets.length + 1}`)
            .then((id) => { if (id) void handleSelectSheet(id); })}
          activeSheetId={activeSheetId}
          onSelect={handleSelectSheet}
          onAdd={handleAddSheet}
          onRename={(id, name) => (privateIds.has(id) ? ss.renamePrivateSheet(id, name) : ss.renameSheet(id, name))}
          onDelete={(id) => void (privateIds.has(id) ? ss.deletePrivateSheet(id)
            : allSheets.find((x) => x.id === id)?.linked_from ? ss.unlink(id) : ss.deleteSheet(id))}
        />
      </SheetCard>

      <StatusBar
        sync={syncView({ connected: ss.connected, loaded: ss.loaded, saving: ss.mutating, info: ss.sync })}
        peers={peers}
        cells={ss.cells.length}
      />

      {/* ── Overlays ─────────────────────────────────────────────── */}
      {showHelp && (
        <FunctionHelpPanel
          functions={ss.functions}
          onClose={() => setShowHelp(false)}
        />
      )}
      {showInvite && (
        <InviteModal
          code={inviteCode}
          // Says what the invitation actually grants. The grant is the
          // NAMESPACE — one membership covers every spreadsheet in it — so the
          // UI says that rather than implying a narrower scope than it gives.
          scope={`${ws.namespaceName} · all ${ws.workspaces.length} spreadsheet${ws.workspaces.length === 1 ? '' : 's'}, opening “${activeWorkspaceName}”`}
          loading={ws.inviteLoading && !inviteCode}
          error={inviteError}
          onClose={() => setShowInvite(false)}
        />
      )}
      {needsNickname && myName.ready && !adoptNamespaceName && (
        <NicknameModal
          projectName={activeWorkspaceName}
          initialName={selfNamespaceName || rememberedName()}
          saving={savingNickname}
          error={nicknameError}
          onSubmit={(name) => void submitNickname(name)}
          onSkip={() => setNicknameSkipped(true)}
        />
      )}
      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          activeFormat={activeCellFormat}
          onSelect={(fmt) => void applyFormat(fmt)}
          sections={menuSections}
          onClose={() => setCtxMenu(null)}
        />
      )}
      {showActivity && (
        <ActivityPanel
          load={ss.loadActivity}
          revision={ss.cells}
          nameOf={personName}
          sheetName={idToName}
          refOf={(sheetId, rowId, colId) => {
            const at = ss.refOf(sheetId, rowId, colId);
            return at ? cellRef(at.row, at.col) : null;
          }}
          showRaw={(sheetId, raw) => idsToNames(ss.displayRaw(sheetId, raw), idToName)}
          selected={selectedIds && activeSheetId ? { sheetId: activeSheetId, rowId: selectedIds.row_id, colId: selectedIds.col_id } : null}
          onJump={(sheetId, rowId, colId) => { if (jumpTo(sheetId, rowId, colId)) setShowActivity(false); }}
          onClose={() => setShowActivity(false)}
        />
      )}
      {showComments && (
        <CommentsPanel
          comments={ss.comments}
          cell={selectedIds && activeSheetId && selectedCell
            ? { sheetId: activeSheetId, rowId: selectedIds.row_id, colId: selectedIds.col_id, label: cellRef(selectedCell.row, selectedCell.col) }
            : null}
          selfId={ss.selfId}
          nameOf={personName}
          where={commentWhere}
          onAdd={async (text, parent) => {
            if (!activeSheetId || !selectedCell) throw new Error('Select a cell first');
            await ss.addComment(activeSheetId, selectedCell.row, selectedCell.col, text, parent);
          }}
          onEdit={ss.editComment}
          onResolve={ss.resolveComment}
          onDelete={ss.deleteComment}
          onJump={(c) => { jumpTo(c.sheet_id, c.row_id, c.col_id); }}
          onClose={() => setShowComments(false)}
        />
      )}
      {noteCell && noteLabel && (
        <NotePanel
          key={`${noteCell.sheetId}|${noteCell.rowId}|${noteCell.colId}`}
          label={noteLabel}
          load={loadOpenNote}
          revision={ss.notedCells}
          onEdit={editOpenNote}
          onClose={() => setNoteCell(null)}
        />
      )}
      {ss.alerts.length > 0 && (
        <MentionToast role="status" data-testid="toast-alert" style={{ bottom: 92 }}>
          <span>🔔 {ss.alerts[ss.alerts.length - 1].message}</span>
          <button type="button" onClick={() => {
            const a = ss.alerts[ss.alerts.length - 1];
            if (allSheets.some((x) => x.id === a.sheetId)) setActiveSheetId(a.sheetId);
            ss.dismissAlert(ss.alerts.length - 1);
          }}>View</button>
          <button type="button" aria-label="Dismiss" onClick={() => ss.dismissAlert(ss.alerts.length - 1)}>×</button>
        </MentionToast>
      )}
      {showLinks && activeSheetId && (
        <LinksPanel
          selection={!isPrivateActive && !activeLinkedFrom && menuRect() ? namesSelection : null}
          workbooks={ws.workspaces.filter((w) => w.contextId !== ws.contextId).map((w) => ({ contextId: w.contextId, name: w.name }))}
          outgoing={ss.publications.map((p) => {
            const a = ss.refOf(p.sheet_id, p.top_row_id, p.left_col_id);
            const b = ss.refOf(p.sheet_id, p.bottom_row_id, p.right_col_id);
            const sheet = idToName(p.sheet_id);
            return {
              id: p.id,
              name: p.name,
              canStop: p.created_by === ss.selfId || isOwner,
              target: ws.workspaces.find((w) => w.contextId === p.target_context)?.name ?? `${p.target_context.slice(0, 8)}…`,
              where: a && b ? `${sheet ? sheetPrefix(sheet) : ''}${rangeRef(a, b)}` : null,
            };
          })}
          incoming={ss.sheets.filter((x) => x.linked_from).map((x) => ({ sheetId: x.id, name: x.name, from: x.linked_from }))}
          canEdit={myRole === 'owner' || myRole === 'editor'}
          onPublish={async (target, name) => {
            const r = menuRect();
            if (r) await ss.publishRange(activeSheetId, r, target, name);
          }}
          onPush={ss.pushPublication}
          onUnpublish={ss.unpublish}
          onUnlink={ss.unlink}
          onClose={() => setShowLinks(false)}
        />
      )}
      {mention && (
        <MentionToast role="status" data-testid="toast-mention">
          <span>
            <strong>{personName(mention.author)}</strong> mentioned you
            {mentionComment && commentWhere(mentionComment) ? ` on ${commentWhere(mentionComment)}` : ''}
          </span>
          <button type="button" onClick={() => {
            if (mentionComment) jumpTo(mentionComment.sheet_id, mentionComment.row_id, mentionComment.col_id);
            ss.dismissMention(mention.commentId);
            setShowComments(true);
          }}>View</button>
          <button type="button" aria-label="Dismiss" onClick={() => ss.dismissMention(mention.commentId)}>×</button>
        </MentionToast>
      )}
      {filterCol !== null && activeFilter && activeSheetId && (() => {
        const values = columnValues(activeFilter, filterCol, valueAt);
        return (
          <FilterModal
            column={columnLabel(filterCol)}
            values={values}
            shown={activeFilter.columns[filterCol] ?? values}
            onApply={(shown) => {
              saveFilters({ ...filters, [activeSheetId]: withColumn(activeFilter, filterCol, shown, values) });
              setFilterCol(null);
            }}
            onClose={() => setFilterCol(null)}
          />
        );
      })()}
      {showCharts && activeSheetId && (
        <ChartsPanel
          charts={ss.charts.filter((c) => c.chart.sheet_id === activeSheetId).map(({ id, chart }) => {
            const a = ss.refOf(activeSheetId, chart.top_row_id, chart.left_col_id);
            const b = ss.refOf(activeSheetId, chart.bottom_row_id, chart.right_col_id);
            const rect = a && b ? normalizeRect(a, b) : null;
            return {
              id,
              kind: chart.kind === 'line' ? 'line' : 'bar',
              title: chart.title,
              model: rect ? chartModel(rect, valueAt, (col) => `Column ${columnLabel(col)}`) : null,
              where: rect ? rangeRef({ row: rect.top, col: rect.left }, { row: rect.bottom, col: rect.right }) : null,
            };
          })}
          selection={selectionRange ? namesSelection : null}
          canEdit={canResize}
          onAdd={async (kind, title) => { if (selectionRange) await ss.addChart(activeSheetId, selectionRange, kind, title); }}
          onRemove={ss.removeChart}
          onClose={() => setShowCharts(false)}
        />
      )}
      {pick && (
        <PickMenu role="listbox" aria-label="Choose a value" style={{ left: pick.x, top: pick.y }} data-testid="menu-pick">
          {pick.options.map((o) => (
            <li key={o} role="option" aria-selected={false}
              onMouseDown={(e) => {
                e.preventDefault();
                if (activeSheetId) void ss.setCell(activeSheetId, pick.row, pick.col, o);
                setPick(null);
              }}
            >
              {o}
            </li>
          ))}
        </PickMenu>
      )}
      {rulesMode && activeSheetId && (
        <RulesModal
          mode={rulesMode}
          selection={namesSelection}
          items={placedRules
            .filter((p) => (rulesMode === 'format' ? p.rule.kind === 'format' || p.rule.kind === 'scale' : p.rule.kind === rulesMode))
            .map((p) => ({
              id: p.id,
              where: rangeRef({ row: p.rect.top, col: p.rect.left }, { row: p.rect.bottom, col: p.rect.right }),
              summary: p.rule.kind === 'scale'
                ? 'Colour scale'
                : `${p.rule.kind === 'validate' ? (p.rule.strict ? 'Only' : 'Mark if not') : 'When'} ${conditionLabel(p.rule.condition)}${p.rule.args.length ? ` ${p.rule.args.join(p.rule.condition === 'one_of' ? ', ' : ' and ')}` : ''}${
                  p.rule.kind === 'alert' ? `, tell ${p.rule.recipients.map(personName).join(', ')}` : ''}`,
            }))}
          people={ss.members.map((m) => ({ id: m.id, name: personName(m.id) }))}
          saving={rulesSaving}
          error={rulesError}
          onAdd={(spec) => {
            const r = menuRect();
            if (!r) return;
            void runRules(() => ss.addRule(activeSheetId, r, spec));
          }}
          onRemove={(id) => void runRules(() => ss.removeRule(id))}
          onClose={() => setRulesMode(null)}
        />
      )}
      {importing && (
        <ErrorToast role="status" data-testid="toast-import" style={{ borderColor: C.line, bottom: 140 }}>
          <span>{importing}</span>
          <button type="button" aria-label="Dismiss" onClick={() => setImporting(null)}>×</button>
        </ErrorToast>
      )}
      {showFiles && selectedIds && activeSheetId && selectedCell && (
        <AttachmentsPanel
          label={cellRef(selectedCell.row, selectedCell.col)}
          files={ss.attachments.filter((a) => a.sheet_id === activeSheetId && a.row_id === selectedIds.row_id && a.col_id === selectedIds.col_id)}
          canEdit={canResize && !selectedLock}
          selfId={ss.selfId}
          isOwner={isOwner}
          nameOf={personName}
          onUpload={(file) => ss.attachFile(activeSheetId, selectedCell.row, selectedCell.col, file)}
          onRemove={ss.removeAttachment}
          onFetch={ss.fetchAttachment}
          onClose={() => setShowFiles(false)}
        />
      )}
      {writeError != null && (
        <ErrorToast role="alert" data-testid="toast-write-error">
          <span>Not saved: {describeError(writeError)}</span>
          <button type="button" aria-label="Dismiss" onClick={dismissWriteError}>×</button>
        </ErrorToast>
      )}
      {showPeople && (
        <PeoplePanel
          members={ss.members}
          group={groupMembers}
          selfId={ss.selfId}
          workspaceName={ws.namespaceName}
          nameOf={personName}
          canManageRoles={isOwner}
          isGroupAdmin={isGroupAdmin}
          onSetRole={ss.setRole}
          onSetGroupRole={async (account, role) => {
            if (!admin || !ws.namespaceId) return;
            await admin.updateMemberRole(ws.namespaceId, account, { role });
            await refetchGroup();
          }}
          onRemove={async (account) => {
            if (!admin || !ws.namespaceId) return;
            await admin.removeGroupMembers(ws.namespaceId, { members: [account] });
            await refetchGroup();
          }}
          policy={replicaPolicy}
          policyUnavailable={isDelegated}
          onSetPolicy={async (p) => {
            if (!admin || isDelegated || !ws.namespaceId) return null;
            const { stored, warning } = await storeReplicaPolicy(admin, ws.namespaceId, p);
            setReplicaPolicy(stored);
            return warning;
          }}
          onClose={() => setShowPeople(false)}
        />
      )}
      {showProtect && activeSheetId && (
        <ProtectModal
          selection={namesSelection}
          items={ss.protections.filter((p) => p.sheet_id === activeSheetId).map((p) => {
            const at = placed.find((x) => x.id === p.id);
            return {
              id: p.id,
              where: !at ? null : at.wholeSheet ? 'Whole sheet'
                : rangeRef({ row: at.rect.top, col: at.rect.left }, { row: at.rect.bottom, col: at.rect.right }),
              description: p.description,
              editors: p.editors,
            };
          })}
          people={ss.members.filter((m) => m.role !== 'owner').map((m) => ({ id: m.id, name: personName(m.id) }))}
          saving={protectSaving}
          error={protectError}
          onProtect={(whole, description, editors) => {
            const r = menuRect();
            void runProtect(() => ss.protectRange(activeSheetId, whole ? null : r, description, editors));
          }}
          onUpdate={(id, description, editors) => void runProtect(() => ss.updateProtection(id, description, editors))}
          onRemove={(id) => void runProtect(() => ss.removeProtection(id))}
          onClose={() => setShowProtect(false)}
        />
      )}
      {showNames && (
        <NamesModal
          names={ss.namedRanges.map((n) => ({ name: n.name, target: idsToNames(`=${n.target}`, idToName).slice(1) }))}
          selection={namesSelection}
          saving={namesSaving}
          error={namesError}
          onDefine={(name) => {
            const r = menuRect();
            if (activeSheetId && r) void runNames(() => ss.defineName(name, activeSheetId, r));
          }}
          onDelete={(name) => void runNames(() => ss.deleteName(name))}
          onClose={() => setShowNames(false)}
        />
      )}
    </AppShell>
  );
}

// ── Styled components ────────────────────────────────────────────────────────

/** The app's mark: a little sheet. Drawn, not an image, so it takes the
 *  theme's colour. */
function SheetGlyph({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <path d="M3 9h18M3 15h18M9 3v18" />
    </svg>
  );
}

const spin = keyframes`to { transform: rotate(360deg); }`;

const PickMenu = styled.ul`
  position: fixed; z-index: 150; margin: 4px 0 0; padding: 6px; list-style: none;
  min-width: 160px; max-height: 260px; overflow-y: auto;
  background: var(--glass-surface-solid); border: 1px solid var(--glass-edge); border-radius: 14px;
  box-shadow: var(--glass-shadow-float);
  li { padding: 8px 12px; font-size: 13px; color: ${C.ink}; border-radius: 9px; cursor: pointer; }
  li:hover { background: var(--glass-sunken); }
`;

const toast = `
  position: fixed; left: 50%; transform: translateX(-50%); z-index: 250;
  display: flex; align-items: center; gap: 12px; max-width: min(560px, calc(100vw - 32px));
  padding: 10px 12px 10px 16px; border-radius: 999px; font-size: 13px;
  color: ${C.ink}; background: var(--glass-surface-solid);
  box-shadow: var(--glass-shadow-float);
`;

const ErrorToast = styled.div`
  ${toast}
  bottom: 96px;
  border: 1px solid ${C.danger};
  button { font-size: 16px; color: ${C.muted}; background: none; border: none; cursor: pointer; padding: 0 4px; }
`;

const MentionToast = styled.div`
  ${toast}
  bottom: 52px;
  border: 1px solid var(--glass-edge);
  button {
    font-size: 12.5px; font-weight: 650; color: ${C.greenDeep}; background: none; border: none;
    cursor: pointer; padding: 4px 6px; border-radius: 999px;
  }
  button:hover { background: var(--glass-sunken); }
`;

/* The whole workbook: the glass ground with the frame floating over it. No
   transform, filter or backdrop-filter here or on the sheet card: overlays,
   menus and toasts are fixed to the viewport, and any of those would trap them
   in the box instead. */
const AppShell = styled.div`
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 100%;
  height: 100vh;
  height: 100dvh;
  padding: 12px 14px 8px;
  overflow: hidden;
  background-color: var(--glass-ground);
  background-image: var(--glass-fields);
  background-attachment: fixed;
  color: ${C.ink};
  font-family: var(--glass-font);
  /* Controls (and the dialogs rendered in here) take the app's type. */
  button, input, select, textarea { font-family: inherit; }
  /* A touch browser (iOS Safari) zooms the page in when a field under 16px
     takes focus and does not zoom back out, leaving the page panned sideways
     with the row numbers and column A out of view. */
  @media (pointer: coarse) { input, select, textarea { font-size: 16px; } }
  @media (max-width: 640px) { padding: 8px 8px 6px; gap: 8px; }
`;

/* The floating glass header (the fleet's glass-header look). It holds no
   fixed-position children, so its backdrop blur traps nothing. */
const TopBar = styled.header`
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 60px;
  flex-shrink: 0;
  padding: 8px 10px 8px 12px;
  border-radius: 20px;
  background: ${C.chrome};
  -webkit-backdrop-filter: var(--glass-blur);
  backdrop-filter: var(--glass-blur);
  border: 1px solid var(--glass-edge);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.5), var(--glass-shadow);
  position: relative;
  z-index: 20;
  @media (max-width: 640px) { gap: 6px; min-height: 54px; padding: 6px 6px 6px 8px; border-radius: 18px; }
`;

const AppMark = styled.div<{ $hideOnPhone?: boolean }>`
  width: 38px;
  height: 38px;
  flex-shrink: 0;
  display: grid;
  place-items: center;
  border-radius: 12px;
  color: #fff;
  background: linear-gradient(140deg, #22c55e 0%, #0ea5e9 100%);
  box-shadow: 0 8px 18px -10px rgba(14, 120, 80, 0.8), inset 0 1px 0 rgba(255, 255, 255, 0.35);
  @media (max-width: 640px) { ${(p) => (p.$hideOnPhone ? 'display: none;' : 'width: 34px; height: 34px; border-radius: 11px;')} }
`;

const TitleBlock = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
`;

const TitleName = styled.span`
  font-size: 15.5px;
  font-weight: 750;
  color: ${C.ink};
  letter-spacing: -0.3px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const TitleMeta = styled.span`
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: ${C.muted};
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const LivePill = styled.span<{ $on: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 20px;
  padding: 0 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 700;
  color: ${(p) => (p.$on ? 'var(--glass-good-ink)' : C.muted)};
  background: ${(p) => (p.$on ? 'var(--glass-good-bg)' : 'var(--glass-sunken)')};
  span { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
`;

const TopSpacer = styled.div`
  flex: 1;
  min-width: 4px;
`;

const Avatars = styled.div`
  display: flex;
  align-items: center;
  padding-left: 6px;
  @media (max-width: 640px) { display: none; }
`;

const Avatar = styled.span<{ $self: boolean }>`
  width: 30px; height: 30px;
  margin-left: -8px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 750;
  color: ${C.onAccent};
  border: 2px solid var(--glass-surface-solid);
  box-shadow: ${(p) => (p.$self ? `0 0 0 2px ${C.green}` : 'none')};
`;

const CollabCount = styled.span`
  font-size: 12.5px;
  color: ${C.muted};
  white-space: nowrap;
  margin-right: 4px;
  @media (max-width: 900px) { display: none; }
`;

const PrimaryAction = styled.button`
  ${primaryPill}
  min-height: 38px;
  padding: 0 16px;
  svg { flex-shrink: 0; }
  @media (max-width: 640px) { width: 38px; padding: 0; span { display: none; } }
`;

const LogoutBtn = styled.button`
  ${secondaryPill}
  min-height: 38px;
  padding: 0 14px;
  background: transparent;
  svg { flex-shrink: 0; }
  @media (max-width: 640px) { width: 38px; padding: 0; span { display: none; } }
`;

const BackBtn = styled.button`
  width: 38px;
  height: 38px;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--glass-ink-2);
  background: var(--glass-sunken);
  border: none;
  border-radius: 999px;
  cursor: pointer;
  transition: background 0.14s, color 0.14s;
  &:hover { background: var(--glass-line-strong); color: ${C.ink}; }
  &:focus-visible { outline: 2px solid var(--glass-accent); outline-offset: 2px; }
`;

/* The tool dock: a frosted strip of grouped tools. It scrolls sideways on a
   phone rather than pushing the page wider. */
const ToolDock = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  padding: 6px;
  border-radius: 16px;
  background: ${C.chrome};
  -webkit-backdrop-filter: var(--glass-blur);
  backdrop-filter: var(--glass-blur);
  border: 1px solid var(--glass-edge);
  box-shadow: var(--glass-shadow);
  overflow-x: auto;
  scrollbar-width: none;
  &::-webkit-scrollbar { display: none; }
`;

const ToolGroup = styled.div`
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 2px;
  flex-shrink: 0;
  border-radius: 12px;
  background: var(--glass-sunken);
`;

const DockSpacer = styled.div`
  flex: 1;
  min-width: 0;
`;

const toolBase = `
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 34px;
  color: var(--glass-ink-2);
  background: transparent;
  border: none;
  border-radius: 10px;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.14s, color 0.14s, box-shadow 0.14s;
  svg { flex-shrink: 0; }
  &:hover:not(:disabled) {
    background: var(--glass-surface-solid);
    color: ${C.ink};
    box-shadow: 0 1px 2px rgba(14, 18, 34, 0.08);
  }
  &:focus-visible { outline: 2px solid var(--glass-accent); outline-offset: 1px; }
  &:disabled { opacity: 0.35; cursor: default; }
`;

const IconBtn = styled.button`
  ${toolBase}
  width: 34px;
`;

const ToolBtn = styled.button`
  ${toolBase}
  gap: 6px;
  padding: 0 11px;
  font: 600 12.5px/1 var(--glass-font);
  @media (max-width: 1100px) { span { display: none; } padding: 0 9px; }
`;

const XlsxTag = styled.span`
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.02em;
`;

const Badge = styled.b`
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  display: inline-grid;
  place-items: center;
  border-radius: 999px;
  font-size: 10.5px;
  font-weight: 750;
  color: var(--glass-on-ink);
  background: var(--glass-accent-solid);
`;

/* The sheet itself: one solid, rounded card. Solid on purpose — the grid must
   stay crisp — and free of transform/filter so nothing fixed is trapped. */
const SheetCard = styled.main`
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: ${C.paper};
  border: 1px solid var(--glass-edge);
  border-radius: 18px;
  box-shadow: var(--glass-shadow);
  @media (max-width: 640px) { border-radius: 14px; }
`;

/* The formula bar and its commit buttons, which sit at its right end. */
const FormulaRow = styled.div`
  position: relative;
  flex-shrink: 0;
  z-index: 10;
`;

const CommitBar = styled.div`
  display: flex;
  align-items: center;
  position: absolute;
  right: 10px;
  top: 0;
  bottom: 0;
  z-index: 20;
  gap: 4px;
`;

const CommitBtn = styled.button`
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
  font-size: 14px;
  color: var(--glass-on-ink);
  background: var(--glass-ink);
  border: none;
  border-radius: 999px;
  cursor: pointer;
  transition: background 0.14s;
  &:hover { background: var(--glass-ink-2); }
`;

const CancelCommitBtn = styled.button`
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
  font-size: 14px;
  color: ${C.danger};
  background: var(--glass-surface-solid);
  border: none;
  box-shadow: inset 0 0 0 1px var(--glass-line-strong);
  border-radius: 999px;
  cursor: pointer;
  transition: background 0.14s;
  &:hover { background: var(--glass-bad-bg); }
`;

// ── Picker and opening screens ───────────────────────────────────

const PickerShell = styled.div`
  min-height: 100vh;
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
  padding: 12px 14px 32px;
  background-color: var(--glass-ground);
  background-image: var(--glass-fields);
  background-attachment: fixed;
  color: ${C.ink};
  font-family: var(--glass-font);
  button, input, select, textarea { font-family: inherit; }
  @media (max-width: 640px) { padding: 8px 8px 24px; }
`;

const PickerMain = styled.div`
  width: 100%;
  max-width: 1040px;
  margin: 0 auto;
  padding: 48px 8px 0;
  @media (max-width: 640px) { padding: 28px 6px 0; }
`;

const PickerHero = styled.div`
  margin-bottom: 28px;
  h1 {
    font-size: clamp(30px, 5vw, 44px);
    font-weight: 800;
    letter-spacing: -1.2px;
    line-height: 1.05;
    margin: 6px 0 12px;
    color: ${C.ink};
    overflow-wrap: anywhere;
  }
  p { max-width: 560px; font-size: 15.5px; line-height: 1.6; color: ${C.muted}; }
`;

const Eyebrow = styled.span`
  font-size: 12px;
  font-weight: 750;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--glass-accent);
`;

const PickerGrid = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr);
  gap: 18px;
  align-items: start;
  @media (max-width: 820px) { grid-template-columns: minmax(0, 1fr); }
`;

/* A frosted card on the ground. Holds no fixed-position children (the join
   dialog renders beside the cards, not inside one). */
const Card = styled.div`
  padding: 22px;
  border-radius: 22px;
  background: var(--glass-surface);
  -webkit-backdrop-filter: var(--glass-blur);
  backdrop-filter: var(--glass-blur);
  border: 1px solid var(--glass-edge);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.45), var(--glass-shadow);
  h2 { font-size: 17px; font-weight: 750; letter-spacing: -0.3px; color: ${C.ink}; }
  > p { font-size: 14px; color: ${C.muted}; line-height: 1.6; margin: 0 0 20px; }
  @media (max-width: 640px) { padding: 18px; border-radius: 20px; }
`;

const CardHead = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 16px;
`;

const CountPill = styled.span`
  min-width: 24px;
  height: 24px;
  padding: 0 8px;
  display: inline-grid;
  place-items: center;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 750;
  color: var(--glass-ink-2);
  background: var(--glass-sunken);
`;

const WorkspaceList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 420px;
  overflow-y: auto;
  text-align: left;
`;

const WorkspaceRow = styled.button`
  display: flex;
  align-items: center;
  gap: 14px;
  width: 100%;
  padding: 12px 14px 12px 12px;
  font-family: inherit;
  background: var(--glass-surface-solid);
  border: 1px solid var(--glass-line);
  border-radius: 16px;
  cursor: pointer;
  text-align: left;
  transition: border-color 0.14s, box-shadow 0.16s, transform 0.12s;

  &:hover {
    border-color: var(--glass-line-strong);
    box-shadow: 0 12px 28px -18px rgba(20, 26, 60, 0.45);
    transform: translateY(-1px);
  }
  &:focus-visible { outline: 2px solid var(--glass-accent); outline-offset: 2px; }
`;

const RowIcon = styled.span`
  width: 40px;
  height: 40px;
  flex-shrink: 0;
  display: grid;
  place-items: center;
  border-radius: 12px;
  color: var(--glass-good-ink);
  background: var(--glass-good-bg);
`;

const WorkspaceMeta = styled.div`
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
  flex: 1;
`;

const WorkspaceName = styled.span<{ $placeholder?: boolean }>`
  font-size: 14.5px;
  font-weight: ${(p) => (p.$placeholder ? 500 : 650)};
  font-style: ${(p) => (p.$placeholder ? 'italic' : 'normal')};
  color: ${(p) => (p.$placeholder ? C.mutedSoft : C.ink)};
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const WorkspaceId = styled.span`
  font-size: 11.5px;
  font-family: ui-monospace, 'SF Mono', Menlo, monospace;
  color: ${C.muted};
`;

const OpenChevron = styled.span`
  width: 32px;
  height: 32px;
  flex-shrink: 0;
  display: grid;
  place-items: center;
  border-radius: 999px;
  color: var(--glass-ink-2);
  background: var(--glass-sunken);
`;

const EmptyList = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 32px 20px;
  text-align: center;
  border-radius: 18px;
  border: 1.5px dashed var(--glass-line-strong);
  strong { margin-top: 8px; font-size: 15px; font-weight: 700; color: ${C.ink}; }
  span { font-size: 13.5px; color: ${C.muted}; line-height: 1.5; }
`;

const FieldLabel = styled.label`
  display: block;
  margin-bottom: 8px;
  font-size: 12.5px;
  font-weight: 650;
  color: ${C.muted};
`;

const ProjectNameInput = styled.input`
  ${field}
  margin-bottom: 18px;
`;

const ButtonRow = styled.div`
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  > * { flex: 1 1 auto; }
`;

const PrimaryBtn = styled.button`
  ${primaryPill}
  min-height: 44px;
`;

const SecondaryBtn = styled.button`
  ${secondaryPill}
  min-height: 44px;
`;

const ErrLine = styled.p`
  margin: 12px 0 0;
  font-size: 13px;
  color: ${C.danger};
`;

const StatusLine = styled.p`
  margin: 12px 0 0;
  font-size: 13px;
  color: ${C.muted};
`;

const OpeningWrap = styled.div`
  flex: 1;
  display: grid;
  place-items: center;
  padding: 24px 0;
  > div {
    width: 100%;
    max-width: 440px;
    text-align: center;
    padding: 32px 28px;
    h2 { font-size: 20px; margin: 0 0 8px; }
    p { font-size: 14px; color: ${C.muted}; line-height: 1.6; margin: 0 0 22px; }
  }
`;

const Spinner = styled.span`
  display: block;
  width: 30px;
  height: 30px;
  margin: 0 auto 18px;
  border-radius: 50%;
  border: 3px solid var(--glass-line-strong);
  border-top-color: var(--glass-ink);
  animation: ${spin} 0.8s linear infinite;
`;
