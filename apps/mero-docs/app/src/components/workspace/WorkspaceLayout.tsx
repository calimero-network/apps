// Three-pane workspace shell:
//   - top bar (logo + NamespaceSwitcher, search in the centre)
//   - left rail (Home, Views, Tags, then FolderTree); a drawer below md
//   - main content: DocumentEditor rendered inline in the main pane
//     (gated on selectedFolderId for save-stability, NOT selectedFolder)
//     when a doc is open; else Home, scoped to the folder when one is selected.
//
// Mounted by App.tsx on the /app/* route (via WorkspacePage's
// auth-guarded shell). The session (SessionProvider) is the app-level provider;
// workspace + registry state comes from the useDriveWorkspace hook.
//
// The open doc and the settings view come from the URL (useAppRoute), so
// reload, back/forward and shared links all land on the same screen.

import React, {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { Settings, LogOut, Circle, PanelLeft } from 'lucide-react';
import { ManageInHomeLink } from '@calimero-apps/passkey';
import { useMero } from '@/calimero/react';
import { LogoWithText } from '@/components/icons/Logo';
import { Button } from '@/components/ui/button';
import { NamespaceSwitcher } from './NamespaceSwitcher';
import { NamespaceSettingsPanel } from './NamespaceSettingsPanel';
import { SidebarDrawer, WorkspaceSidebar } from './WorkspaceSidebar';
import { FolderTree } from '@/components/folders/FolderTree';
import { RestrictedFolderCard } from '@/components/folders/RestrictedFolderCard';
import { openAudience } from '@/lib/folderRestriction';
import { EmptyState, QuietLoading } from '@/components/ui/empty-state';
import { HomePage } from '@/components/home/HomePage';
import { WorkspaceIndexProvider } from '@/context/WorkspaceIndexContext';
import { LinkTargetCard } from './LinkTargetCard';
import { WorkspaceNav } from './WorkspaceNav';
import { useDriveWorkspace } from '@/hooks/useDriveWorkspace';
import { useAppRoute } from '@/hooks/useAppRoute';
import { useDocs } from '@/hooks/useDocs';
import { MD_QUERY, useMediaQuery } from '@/hooks/useMediaQuery';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { usePublishWorkspacePresence } from '@/hooks/useWorkspacePresence';
import { useFolderPermissions } from '@/hooks/useFolderPermissions';
import { lacksFolderAccess } from '@/utils/accessDenied';
import { resolveLinkTarget } from '@/lib/linkTarget';
import { ThemeToggle } from '@/components/theme/ThemeToggle';
import { useLocalStorage } from '@/hooks/useLocalStorage';
import { DisplayNameGate } from './DisplayNameGate';
import { TopBarSearch } from '@/components/search/TopBarSearch';
import { SearchContainer } from '@/components/search/SearchContainer';
import { useRecentDocs } from '@/hooks/useRecentDocs';

const EDITOR_SELECTOR = '.bn-editor'; // Cmd/Ctrl+K there is the editor's own link shortcut
const SEARCH_KEY_CODE = 'KeyK'; // the physical key, so the shortcut works on any layout

// Code-split the editor: BlockNote + its Mantine UI are ~360 KB gzip and
// only needed once a document is opened, so they must not weigh down the
// landing / login / folder-view initial load.
const DocumentEditor = lazy(() =>
  import('@/components/docs/DocumentEditor').then((m) => ({
    default: m.DocumentEditor,
  })),
);

export function WorkspaceLayout() {
  const {
    namespaceId,
    namespaces,
    namespacesListed,
    namespacesError,
    isJustJoined,
    registryContextId,
    selectedFolderId,
    setSelectedFolder,
    folders,
    registryFolders,
    resolvedFolderIds,
    hiddenFolderIds,
    selfIdentity,
    stage,
    refetch,
  } = useDriveWorkspace();
  const { nodeUrl, nodeLabel, logout, session } = useMero();
  // Grace-wrapped so a transient SSE blip doesn't flap the node dot red.
  const isOnline = useOnlineStatus();
  usePublishWorkspacePresence(registryContextId, selfIdentity);
  const selectedFolder = folders.find((f) => f.id === selectedFolderId);

  // Per-folder permission probe. caps=null while fetching; caps=0
  // means "not a member" (or genuinely no caps). See RestrictedFolderCard
  // branch below for how we distinguish from "still loading".
  const selectedFolderPerms = useFolderPermissions(
    namespaceId ?? '',
    selectedFolder?.id ?? '',
  );

  // Which cluster this session is on: merod local in development, the
  // Calimero Cloud cluster in production.
  const displayNode =
    nodeLabel ?? 'disconnected';

  const { route, goWorkspace, goHome, goFolder, goDoc, goSettings } =
    useAppRoute();
  const selectedDocId = route?.doc ?? null;
  const showSettings = !!route?.settings;
  const navigate = useNavigate();

  // Workspace ids this node belongs to, from the last successful list read;
  // null until one has landed. A failed re-read never blanks a working screen.
  const namespaceIds = useMemo(
    () => (namespacesListed ? namespaces.map((n) => n.namespaceId) : null),
    [namespacesListed, namespaces],
  );
  // Only fetched once access is confirmed open, so a hidden folder never
  // attempts a context join it has no right to. Archived still counts as existing.
  const folderAccessible =
    !!selectedFolderId &&
    resolvedFolderIds.has(selectedFolderId) &&
    !hiddenFolderIds.has(selectedFolderId);
  const routedDocs = useDocs(folderAccessible ? selectedFolderId : null, {
    includeArchived: true,
  });
  const refetchDocs = routedDocs.refetch;
  const docKey =
    selectedFolderId && selectedDocId
      ? `${selectedFolderId}:${selectedDocId}`
      : null;
  const docMissing =
    routedDocs.listed &&
    !!selectedDocId &&
    !routedDocs.list.some((d) => d.id === selectedDocId);
  // The cached list can predate a doc made or synced moments ago, so only a
  // read that began after the doc was opened may report it gone.
  const [recheckedDocKey, setRecheckedDocKey] = useState<string | null>(null);
  useEffect(() => {
    if (!docMissing || !docKey || recheckedDocKey === docKey) return;
    let alive = true;
    void refetchDocs().then(() => {
      if (alive) setRecheckedDocKey(docKey);
    });
    return () => {
      alive = false;
    };
  }, [docMissing, docKey, recheckedDocKey, refetchDocs]);
  const docsAnswer =
    routedDocs.listed && (!docMissing || recheckedDocKey === docKey)
      ? routedDocs.list
      : null;
  // Core answers a person removed from an Open folder like a non-member of a
  // Restricted one, so the folder is closed to them the same way.
  const noAccessFolderIds = useMemo(
    () =>
      selectedFolderPerms.removed && selectedFolder
        ? new Set([...hiddenFolderIds, selectedFolder.id])
        : hiddenFolderIds,
    [hiddenFolderIds, selectedFolder, selectedFolderPerms.removed],
  );
  const linkTarget = useMemo(
    () =>
      resolveLinkTarget({
        route,
        justJoinedWorkspace: isJustJoined,
        namespaceIds,
        folderRegistry: registryFolders,
        resolvedFolderIds,
        hiddenFolderIds: noAccessFolderIds,
        docs: docsAnswer,
      }),
    [
      route,
      isJustJoined,
      namespaceIds,
      registryFolders,
      resolvedFolderIds,
      noAccessFolderIds,
      docsAnswer,
    ],
  );
  const routedFolder = registryFolders?.find((f) => f.id === selectedFolderId);
  // Name what was linked: a doc link reads as a doc whether or not this node
  // lists its folder, since an unlisted folder may be Restricted to others and
  // the card must not tell that apart from one that never existed. An absent
  // folder keeps its URL so it opens by itself if this node later syncs it.
  const linkSubject = selectedDocId ? 'doc' : 'folder';
  const onLinkTargetGoHome = useCallback(
    () => (linkTarget === 'not-in-workspace' ? goWorkspace(null) : goHome()),
    [linkTarget, goWorkspace, goHome],
  );
  const docsFailed = linkTarget === 'syncing' && !!routedDocs.error;
  // The name gate asks about this workspace, so only a confirmed member sees it.
  const isMember = !!namespaceId && !!namespaceIds?.includes(namespaceId);
  // Once a doc has genuinely opened, a later 'syncing' pulse must not
  // unmount it mid-edit; only a definitive outcome (branch above) does.
  const [openedDocKey, setOpenedDocKey] = useState<string | null>(null);
  useEffect(() => {
    if (docKey && linkTarget === 'ok') setOpenedDocKey(docKey);
  }, [docKey, linkTarget]);
  const { recent, touch } = useRecentDocs(namespaceId ?? '');
  const docOpened =
    linkTarget === 'ok' && !!selectedFolderId && !!selectedDocId;
  useEffect(() => {
    if (docOpened) touch(selectedFolderId!, selectedDocId!);
  }, [docOpened, selectedFolderId, selectedDocId, touch]);
  const [searchOpen, setSearchOpen] = useState(false);
  const hasWorkspace = !!namespaceId;
  useEffect(() => {
    if (!hasWorkspace) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
      if (e.code !== SEARCH_KEY_CODE) return;
      if (e.target instanceof Element && e.target.closest(EDITOR_SELECTOR))
        return;
      e.preventDefault();
      setSearchOpen((open) => !open);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [hasWorkspace]);
  const showEditor =
    !!docKey &&
    (linkTarget === 'ok' ||
      (linkTarget === 'syncing' && openedDocKey === docKey));
  const [sidebarWidth, setSidebarWidth] = useLocalStorage<number>(
    'mero-sidebar-width',
    256,
  );
  const [sidebarCollapsed, setSidebarCollapsed] = useLocalStorage<boolean>(
    'mero-sidebar-collapsed',
    false,
  );
  // Read synchronously so a phone never mounts the inline sidebar first.
  const isDesktop = useMediaQuery(MD_QUERY);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const sidebarShown = isDesktop ? !sidebarCollapsed : drawerOpen;
  // The drawer is phone-only, so a trip through a wide screen must not bring it back.
  useEffect(() => {
    if (isDesktop) setDrawerOpen(false);
  }, [isDesktop]);
  const selectFolder = useCallback(
    (folderId: string) => {
      setDrawerOpen(false);
      setSelectedFolder(folderId);
    },
    [setSelectedFolder],
  );

  const openDoc = useCallback(
    (folderId: string, docId: string) => {
      setDrawerOpen(false);
      goDoc(folderId, docId);
    },
    [goDoc],
  );

  // Closing settings returns to the screen it was opened from. The router's
  // history index is 0 on the first in-app entry, even one reached by replace.
  const closeSettings = useCallback(() => {
    if ((window.history.state?.idx ?? 0) > 0) navigate(-1);
    else goHome();
  }, [navigate, goHome]);

  const folderTree = namespaceId ? (
    <WorkspaceNav
      key={namespaceId}
      ws={namespaceId}
      selectedDocId={selectedDocId}
      onSelectFolder={selectFolder}
      onOpenDoc={openDoc}
      onNavigate={() => setDrawerOpen(false)}
    />
  ) : (
    <FolderTree
      selectedDocId={selectedDocId}
      onSelectFolder={selectFolder}
      onOpenDoc={openDoc}
    />
  );

  return (
    <div className="glass-fields flex h-dvh flex-col">
      {/* Top bar: the floating glass header every app shares. */}
      <header className="glass-header flex h-14 shrink-0 items-center justify-between gap-2 px-3 md:px-4">
        <div className="flex min-w-0 items-center gap-2 md:gap-4">
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 shrink-0"
            aria-label={sidebarShown ? 'Hide sidebar' : 'Show sidebar'}
            aria-pressed={sidebarShown}
            onClick={() =>
              isDesktop
                ? setSidebarCollapsed(!sidebarCollapsed)
                : setDrawerOpen(!drawerOpen)
            }
          >
            <PanelLeft className="h-4 w-4" />
          </Button>
          <LogoWithText
            size={22}
            className="shrink-0"
            textClassName="hidden whitespace-nowrap sm:inline"
          />
          <div className="hidden h-6 w-px bg-border sm:block" />
          <NamespaceSwitcher />
        </div>
        {namespaceId && (
          <div className="flex min-w-0 flex-1 justify-center md:px-6">
            <TopBarSearch onOpen={() => setSearchOpen(true)} />
          </div>
        )}
        <div className="flex shrink-0 items-center gap-1 sm:gap-2">
          {/* Connection indicator - shows the cluster and online
              state. Hidden on narrow viewports; title carries the
              full URL for copy-paste. */}
          {nodeUrl && (
            <div
              className="hidden md:flex items-center gap-1.5 text-xs text-muted-foreground px-2"
              title={nodeUrl}
              aria-label={`Connected to ${nodeUrl}${isOnline ? '' : ' (offline)'}`}
            >
              <Circle
                className={`h-2 w-2 ${
                  isOnline
                    ? 'fill-sync-synced text-sync-synced'
                    : 'fill-destructive text-destructive'
                }`}
              />
              <span className="max-w-[16ch] truncate">{displayNode}</span>
            </div>
          )}
          <ThemeToggle />
          <ManageInHomeLink
            session={session}
            org={namespaceId}
            className="hidden whitespace-nowrap px-2 text-xs font-medium text-primary no-underline hover:underline sm:inline"
          />
          {namespaceId && (
            <Button
              variant={showSettings ? 'selected' : 'ghost'}
              size="sm"
              className="gap-1.5"
              aria-label="Settings"
              aria-pressed={showSettings}
              onClick={showSettings ? closeSettings : goSettings}
            >
              <Settings className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Settings</span>
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5"
            onClick={logout}
            aria-label="Log out"
          >
            <LogOut className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Log out</span>
          </Button>
        </div>
      </header>

      {/* One index per workspace: a switch remounts it, so nothing carries over. */}
      <WorkspaceIndexProvider key={namespaceId ?? ''}>
        <div className="relative flex min-h-0 flex-1">
          {!isDesktop ? (
            <SidebarDrawer open={drawerOpen} onOpenChange={setDrawerOpen}>
              {folderTree}
            </SidebarDrawer>
          ) : (
            !sidebarCollapsed && (
              <WorkspaceSidebar
                width={sidebarWidth}
                onWidthChange={setSidebarWidth}
              >
                {folderTree}
              </WorkspaceSidebar>
            )
          )}

          <main className="m-3 flex min-h-0 flex-1 flex-col overflow-hidden rounded-[22px] border border-white/90 bg-card shadow-[0_14px_36px_-24px_rgba(40,50,110,0.4)] dark:border-white/[0.08]">
            {linkTarget === 'no-access' ||
            linkTarget === 'deleted' ||
            linkTarget === 'not-in-workspace' ? (
              // A routed folder/doc/workspace the caller can't open. Checked
              // ahead of settings and the editor so a dead or restricted link
              // never mounts them (settings reads groups this node lacks).
              <div className="flex h-full items-center justify-center p-6">
                <LinkTargetCard
                  kind={linkTarget}
                  subject={linkSubject}
                  folderName={routedFolder?.alias}
                  onGoHome={onLinkTargetGoHome}
                  linkUrl={window.location.href}
                />
              </div>
            ) : showSettings && namespaceId ? (
              <div className="flex-1 overflow-y-auto">
                <NamespaceSettingsPanel key={`settings:${namespaceId}`} />
              </div>
            ) : !namespaceId && !namespacesListed && !namespacesError ? (
              // Nothing is selected before the list confirms what this node holds.
              <QuietLoading />
            ) : !namespaceId ? (
              <EmptyState
                title="No workspace selected"
                body="Create or pick a workspace from the top bar to see your folders."
              />
            ) : selectedFolderId && selectedDocId && showEditor ? (
              // Editor gated on selectedFolderId (stable persistent state),
              // NOT selectedFolder - `folders` is a useMemo that recomputes on
              // every workspace SSE refetch, and a momentary gap where the
              // folder isn't yet in the recomputed array would otherwise flip
              // this to "Select a folder", unmount DocumentEditor mid-save,
              // double-fire edit_doc, and strand the save indicator on
              // "Saving…".
              //
              // This branch also sits ABOVE the 'syncing-from-peers' check:
              // if the workspace re-enters that stage while a doc is open, the
              // syncing empty state must NOT replace (and unmount) the editor
              // mid-edit. DocumentEditor runs its own per-folder permission
              // probe + read-only mode and shows its own "syncing folder"
              // state when its docs context isn't ready, so it is safe to
              // render here ahead of the syncing + access-gating branches.
              <Suspense fallback={<EmptyState title="Loading editor…" />}>
                <DocumentEditor
                  key={`${selectedFolderId}:${selectedDocId}`}
                  folderId={selectedFolderId}
                  docId={selectedDocId}
                  onClose={() => goFolder(selectedFolderId)}
                  // The deleted doc's URL is dead, so it must not stay in history.
                  onDeleted={() =>
                    goFolder(selectedFolderId, { replace: true })
                  }
                  folderName={selectedFolder?.alias}
                />
              </Suspense>
            ) : namespacesError && !namespacesListed ? (
              // Only before any list has landed; a failed re-read keeps the last one.
              <EmptyState
                title="Couldn't load your workspaces"
                body="Check your connection, then try again."
              >
                <Button variant="outline" onClick={() => void refetch()}>
                  Try again
                </Button>
              </EmptyState>
            ) : docsFailed ? (
              <EmptyState title="Couldn't load this folder's documents">
                <Button variant="outline" onClick={() => void refetchDocs()}>
                  Try again
                </Button>
              </EmptyState>
            ) : stage === 'syncing-from-peers' || linkTarget === 'syncing' ? (
              <QuietLoading />
            ) : !selectedFolderId ? (
              <HomePage />
            ) : !selectedFolder ? (
              // A folder IS selected (selectedFolderId set) but its object
              // isn't in the recomputed `folders` list yet - a transient gap
              // during an SSE refetch. Show a neutral loading state rather
              // than flashing "Select a folder" (same stable-id reasoning as
              // the editor branch above).
              <EmptyState title="Loading folder…" />
            ) : selectedFolderPerms.loading ? (
              <EmptyState title="Checking access…" />
            ) : lacksFolderAccess(selectedFolderPerms) ? (
              <div className="flex-1 overflow-y-auto p-6">
                <div className="mx-auto max-w-3xl">
                  <RestrictedFolderCard
                    folderId={selectedFolder.id}
                    folderAlias={selectedFolder.alias}
                    visibility={selectedFolder.visibility}
                    openTo={openAudience(
                      selectedFolder,
                      (id) => folders.find((f) => f.id === id)?.alias,
                    )}
                    selfIdentity={selfIdentity}
                    refetch={refetch}
                    refetchPerms={selectedFolderPerms.refetch}
                  />
                </div>
              </div>
            ) : (
              <HomePage key={selectedFolder.id} folderId={selectedFolder.id} />
            )}
          </main>
          {isMember && <DisplayNameGate />}
        </div>
        {namespaceId && (
          <SearchContainer
            open={searchOpen}
            onOpenChange={setSearchOpen}
            recent={recent}
          />
        )}
      </WorkspaceIndexProvider>
    </div>
  );
}
