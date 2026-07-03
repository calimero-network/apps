// Three-pane workspace shell:
//   - top bar (logo + NamespaceSwitcher)
//   - left rail (FolderTree)
//   - main content: DocumentEditor rendered inline in the main pane
//     (gated on selectedFolderId for save-stability, NOT selectedFolder)
//     when a doc is open; folder view (breadcrumb + header + doc list +
//     sharing) when a folder is selected but no doc is open.
//
// Mounted by App.tsx on the /app/* route (via WorkspacePage's
// auth-guarded shell). MeroProvider is the only app-level provider;
// workspace + registry state comes from the useDriveWorkspace hook.
//
// Selected-document state is intentionally local: no other consumer
// reads it, and keeping it out of useDriveWorkspace avoids unwiring
// a folder's active doc on every workspace re-render.

import React, {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { Settings, LogOut, Circle, PanelLeft } from 'lucide-react';
import { useMero } from '@calimero-network/mero-react';
import { LogoWithText } from '@/components/icons/Logo';
import { Button } from '@/components/ui/button';
import { NamespaceSwitcher } from './NamespaceSwitcher';
import { NamespaceSettingsPanel } from './NamespaceSettingsPanel';
import { WorkspaceSidebar } from './WorkspaceSidebar';
import { FolderTree } from '@/components/folders/FolderTree';
import { RestrictedFolderCard } from '@/components/folders/RestrictedFolderCard';
import { FolderEmptyState } from './FolderEmptyState';
import { useDriveWorkspace } from '@/hooks/useDriveWorkspace';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import type { SyncSnapshot } from '@/hooks/useSyncStatus';
import { useFolderPermissions } from '@/hooks/useFolderPermissions';
import { isAccessDeniedError } from '@/utils/accessDenied';
import { ThemeToggle } from '@/components/theme/ThemeToggle';
import { useLocalStorage } from '@/hooks/useLocalStorage';
import { DisplayNameGate } from './DisplayNameGate';

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
    registryContextId,
    selectedFolderId,
    setSelectedFolder,
    folders,
    selfIdentity,
    stage,
    syncStatus,
    refetch,
  } = useDriveWorkspace();
  const { mero, nodeUrl, logout } = useMero();
  // Grace-wrapped so a transient SSE blip doesn't flap the node dot red.
  const isOnline = useOnlineStatus();
  const selectedFolder = folders.find((f) => f.id === selectedFolderId);

  // Explicit re-trigger for a stalled post-join sync — a real action so a
  // user staring at a stuck "syncing" state re-fires the sync instead of
  // re-joining. Best-effort: the SSE stream + refetch surface the outcome.
  const onRetrySync = useCallback(() => {
    const ids = [namespaceId, registryContextId].filter(
      (id): id is string => !!id,
    );
    for (const id of ids) {
      mero.admin.syncContext(id).catch((err: unknown) => {
        console.warn('retry syncContext failed', id, err);
      });
    }
    void refetch();
  }, [mero, namespaceId, registryContextId, refetch]);
  // Per-folder permission probe. caps=null while fetching; caps=0
  // means "not a member" (or genuinely no caps). See RestrictedFolderCard
  // branch below for how we distinguish from "still loading".
  const selectedFolderPerms = useFolderPermissions(
    namespaceId ?? '',
    selectedFolder?.id ?? '',
  );

  // Friendly display of the node URL — stripped of protocol for
  // compactness, full URL kept in the title attribute for copy-paste.
  const displayNode = (nodeUrl ?? '').replace(/^https?:\/\//, '') || 'disconnected';

  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [sidebarWidth, setSidebarWidth] = useLocalStorage<number>(
    'mero-sidebar-width',
    256,
  );
  const [sidebarCollapsed, setSidebarCollapsed] = useLocalStorage<boolean>(
    'mero-sidebar-collapsed',
    false,
  );
  // The folder the currently-open doc belongs to. Lets the reset
  // effect below distinguish "user clicked a different folder" (clear
  // the doc) from "user opened a doc in another folder" (keep it).
  const selectedDocFolderRef = useRef<string | null>(null);

  const openDoc = useCallback(
    (folderId: string, docId: string) => {
      selectedDocFolderRef.current = folderId;
      setSelectedFolder(folderId);
      setSelectedDocId(docId);
    },
    [setSelectedFolder],
  );

  // Toggle between folder/editor view and the full-pane namespace
  // settings. Closing settings preserves the previously-selected
  // folder so the user lands back where they were.
  const [showSettings, setShowSettings] = useState(false);

  // Clear the open doc when the active folder changes to a folder the
  // doc does NOT belong to — i.e. a folder-row click, remote delete,
  // or permission revoke. When openDoc set both folder + doc together
  // (cross-folder doc open), the ref matches the new folder and the
  // doc is preserved.
  useEffect(() => {
    if (selectedFolderId !== selectedDocFolderRef.current) {
      setSelectedDocId(null);
      selectedDocFolderRef.current = null;
    }
  }, [selectedFolderId]);

  // Close settings when switching namespaces — the active
  // namespace is the settings scope, so dangling on a different
  // namespace's settings after a switch is stale UX.
  useEffect(() => {
    setShowSettings(false);
  }, [namespaceId]);

  // Close settings when the user picks a folder from the sidebar.
  // The settings pane sits in the same <main> slot as the folder
  // view, so without this the folder click only updates
  // selectedFolderId — the user stays staring at settings and has
  // to either un-toggle the Settings button or reload the page.
  useEffect(() => {
    if (selectedFolderId) setShowSettings(false);
  }, [selectedFolderId]);

  return (
    <div className="flex h-screen flex-col bg-background">
      {/* Top bar */}
      <header className="flex h-14 items-center justify-between border-b border-border bg-card px-4">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9"
            aria-label={sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}
            aria-pressed={!sidebarCollapsed}
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          >
            <PanelLeft className="h-4 w-4" />
          </Button>
          <LogoWithText size={22} />
          <div className="hidden h-6 w-px bg-border sm:block" />
          <NamespaceSwitcher />
        </div>
        <div className="flex items-center gap-2">
          {/* Connection indicator — shows the node URL and online
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
                    ? 'fill-[hsl(var(--synced))] text-[hsl(var(--synced))]'
                    : 'fill-destructive text-destructive'
                }`}
              />
              <span className="max-w-[16ch] truncate">{displayNode}</span>
            </div>
          )}
          <ThemeToggle />
          {namespaceId && (
            <Button
              variant={showSettings ? 'default' : 'ghost'}
              size="sm"
              className="gap-1.5"
              aria-pressed={showSettings}
              onClick={() => setShowSettings((v) => !v)}
            >
              <Settings className="h-3.5 w-3.5" />
              Settings
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

      {/* Main grid */}
      <div className="relative flex flex-1">
        {!sidebarCollapsed && (
          <WorkspaceSidebar width={sidebarWidth} onWidthChange={setSidebarWidth}>
            <FolderTree selectedDocId={selectedDocId} onOpenDoc={openDoc} />
          </WorkspaceSidebar>
        )}

        <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {showSettings && namespaceId ? (
            <div className="flex-1 overflow-y-auto">
              <NamespaceSettingsPanel key={`settings:${namespaceId}`} />
            </div>
          ) : !namespaceId ? (
            <EmptyState
              title="No workspace selected"
              body="Create or pick a workspace from the top bar to see your folders."
            />
          ) : selectedFolderId && selectedDocId ? (
            // Editor gated on selectedFolderId (stable persistent state),
            // NOT selectedFolder — `folders` is a useMemo that recomputes on
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
            <Suspense fallback={<EmptyState title="Loading editor…" body="" />}>
              <DocumentEditor
                key={`${selectedFolderId}:${selectedDocId}`}
                folderId={selectedFolderId}
                docId={selectedDocId}
                onClose={() => setSelectedDocId(null)}
              />
            </Suspense>
          ) : stage === 'syncing-from-peers' ? (
            <SyncingWorkspaceState
              syncStatus={syncStatus}
              onRetry={onRetrySync}
            />
          ) : !selectedFolderId ? (
            <EmptyState
              title="Select a folder"
              body="Pick a folder from the left rail to see its documents."
            />
          ) : !selectedFolder ? (
            // A folder IS selected (selectedFolderId set) but its object
            // isn't in the recomputed `folders` list yet — a transient gap
            // during an SSE refetch. Show a neutral loading state rather
            // than flashing "Select a folder" (same stable-id reasoning as
            // the editor branch above).
            <EmptyState title="Loading folder…" body="" />
          ) : selectedFolderPerms.loading ? (
            <EmptyState title="Checking access…" body="" />
          ) : (selectedFolderPerms.error &&
              isAccessDeniedError(selectedFolderPerms.error)) ||
            (!selectedFolderPerms.isMember && !selectedFolderPerms.error) ? (
            <div className="flex-1 overflow-y-auto p-6">
              <div className="mx-auto max-w-3xl">
                <RestrictedFolderCard
                  folderId={selectedFolder.id}
                  folderAlias={selectedFolder.alias}
                  visibility={selectedFolder.visibility}
                  selfIdentity={selfIdentity}
                  refetch={refetch}
                  refetchPerms={selectedFolderPerms.refetch}
                />
              </div>
            </div>
          ) : (
            <FolderEmptyState folderId={selectedFolder.id} onOpenDoc={openDoc} />
          )}
        </main>
        <DisplayNameGate />
      </div>
    </div>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="max-w-md text-center">
        <h2 className="text-xl font-semibold text-foreground">{title}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{body}</p>
      </div>
    </div>
  );
}

// Phase → user-facing copy for the post-join syncing state. Pure and
// lifted out so the component stays declarative (no let-mutation ladder);
// the `default` covers "no event yet" and `idle`.
function describeSync(snap: SyncSnapshot | null): {
  title: string;
  body: string;
} {
  switch (snap?.phase) {
    case 'waitingForPeers':
      return {
        title: 'Connecting to peers…',
        body: 'Finding a node that has this workspace. A fresh cross-network join can take up to a minute.',
      };
    case 'syncing':
      return {
        title: 'Syncing workspace…',
        body: 'Found a peer — pulling the latest workspace state.',
      };
    case 'receivingSnapshot':
      return {
        title: 'Receiving workspace…',
        body:
          snap.etaSecs != null
            ? `Downloading state — about ${snap.etaSecs}s left.`
            : 'Downloading workspace state from a peer.',
      };
    case 'backingOff': {
      const attempt = snap.failureCount
        ? ` (attempt ${snap.failureCount + 1})`
        : '';
      const when =
        snap.retryInSecs != null ? ` in ${snap.retryInSecs}s` : ' shortly';
      return {
        title: 'Reconnecting…',
        body: `Sync hit a snag${attempt}. Retrying${when}.`,
      };
    }
    default:
      return {
        title: 'Syncing workspace from peers…',
        body: "You've just joined this workspace. Connecting to the network to pull its state.",
      };
  }
}

// Post-join "syncing" state, driven by live SSE sync-status so the user
// can tell "still connecting / receiving X%" from "stuck" — the whole
// point of the fix (a static message reads the same as a failure, so
// people re-click Join). Falls back to a generic connecting message
// until the first SyncStatus event arrives.
function SyncingWorkspaceState({
  syncStatus,
  onRetry,
}: {
  syncStatus: SyncSnapshot | null;
  onRetry: () => void;
}) {
  const phase = syncStatus?.phase;
  // `backingOff` is the authoritative "stuck" signal. A `lastError` can
  // linger on the wire during an active phase, so it must NOT hide the
  // spinner / show Retry — it's rendered separately as informational text.
  const stalled = phase === 'backingOff';
  const percent = phase === 'receivingSnapshot' ? syncStatus?.percent : null;
  const { title, body } = describeSync(syncStatus);

  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="w-full max-w-md text-center">
        {!stalled && (
          <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-b-2 border-t-2 border-primary" />
        )}
        <h2 className="text-xl font-semibold text-foreground">{title}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{body}</p>
        {percent != null && (
          <div className="mt-4">
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
              />
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{percent}%</p>
          </div>
        )}
        {stalled && syncStatus?.lastError && (
          <p className="mt-3 text-xs text-destructive">
            {syncStatus.lastError.slice(0, 200)}
          </p>
        )}
        {stalled && (
          <Button variant="outline" className="mt-4" onClick={onRetry}>
            Retry sync
          </Button>
        )}
      </div>
    </div>
  );
}
