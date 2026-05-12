// Three-pane workspace shell:
//   - top bar (logo + NamespaceSwitcher)
//   - left rail (FolderTree)
//   - main content: folder view (breadcrumb + header + doc list +
//     sharing) when a folder is selected; full-screen DocumentEditor
//     when a doc is open.
//
// Mounted by App.tsx on the /app/* route (via WorkspacePage's
// auth-guarded shell). MeroProvider is the only app-level provider;
// workspace + registry state comes from the useDriveWorkspace hook.
//
// Selected-document state is intentionally local: no other consumer
// reads it, and keeping it out of useDriveWorkspace avoids unwiring
// a folder's active doc on every workspace re-render.

import React, { useEffect, useState } from 'react';
import { Settings, LogOut, Circle } from 'lucide-react';
import { useMero } from '@calimero-network/mero-react';
import { LogoWithText } from '@/components/icons/Logo';
import { Button } from '@/components/ui/button';
import { NamespaceSwitcher } from './NamespaceSwitcher';
import { NamespaceSettingsPanel } from './NamespaceSettingsPanel';
import { FolderTree } from '@/components/folders/FolderTree';
import { FolderBreadcrumb } from '@/components/folders/FolderBreadcrumb';
import { FolderSharingPanel } from '@/components/folders/FolderSharingPanel';
import { RestrictedFolderCard } from '@/components/folders/RestrictedFolderCard';
import { DocumentList } from '@/components/docs/DocumentList';
import { DocumentEditor } from '@/components/docs/DocumentEditor';
import { useDriveWorkspace } from '@/hooks/useDriveWorkspace';
import { useFolderPermissions } from '@/hooks/useFolderPermissions';
import { isAccessDeniedError } from '@/utils/accessDenied';

export function WorkspaceLayout() {
  const { namespaceId, selectedFolderId, folders, selfIdentity, stage } =
    useDriveWorkspace();
  const { nodeUrl, isOnline, logout } = useMero();
  const selectedFolder = folders.find((f) => f.id === selectedFolderId);
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
  // Toggle between folder/editor view and the full-pane namespace
  // settings. Closing settings preserves the previously-selected
  // folder so the user lands back where they were.
  const [showSettings, setShowSettings] = useState(false);

  // Clear selectedDocId whenever the active folder changes. Without
  // this reset, switching folders or having the current folder
  // disappear (remote delete, permission revoke) could leave a
  // stale docId in state — and when a new folder lands with that
  // stale docId still set, the editor guard below would re-satisfy
  // and open DocumentEditor with a docId that belongs to the
  // previous folder.
  useEffect(() => {
    setSelectedDocId(null);
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

  // Full-screen editor mode: bypass the workspace chrome entirely.
  // EditorShell owns its own header/toolbar/status-bar and uses
  // h-screen, so we let it take the viewport.
  if (selectedFolder && selectedDocId) {
    return (
      <DocumentEditor
        key={`${selectedFolder.id}:${selectedDocId}`}
        folderId={selectedFolder.id}
        docId={selectedDocId}
        onClose={() => setSelectedDocId(null)}
      />
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Top bar */}
      <header className="flex h-14 items-center justify-between border-b border-border bg-card px-4">
        <div className="flex items-center gap-4">
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
                  isOnline ? 'fill-green-500 text-green-500' : 'fill-destructive text-destructive'
                }`}
              />
              <span className="max-w-[16ch] truncate">{displayNode}</span>
            </div>
          )}
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
      <div className="flex flex-1">
        <aside className="w-64 shrink-0 border-r border-border bg-muted/20">
          <FolderTree />
        </aside>

        <main className="flex-1 overflow-y-auto">
          {showSettings && namespaceId ? (
            <NamespaceSettingsPanel key={`settings:${namespaceId}`} />
          ) : !namespaceId ? (
            <EmptyState
              title="No workspace selected"
              body="Create or pick a workspace from the top bar to see your folders."
            />
          ) : stage === 'syncing-from-peers' ? (
            <EmptyState
              title="Syncing workspace from peers…"
              body="You've just joined this workspace. Waiting for the registry and folder state to propagate from other nodes. This usually takes a second."
            />
          ) : !selectedFolder ? (
            <EmptyState
              title="Select a folder"
              body="Pick a folder from the left rail to see its documents."
            />
          ) : (
            <div className="mx-auto max-w-5xl space-y-6 p-6">
              <FolderBreadcrumb folderId={selectedFolder.id} />
              <div>
                <h1 className="text-2xl font-semibold text-foreground">
                  {selectedFolder.alias}
                </h1>
                <p className="mt-1 text-xs text-muted-foreground">
                  {selectedFolder.visibility === 'Restricted'
                    ? 'Restricted — only explicit members can read/write'
                    : selectedFolder.visibility === 'Open'
                      ? 'Open — namespace members can join and read/write'
                      : 'Loading visibility…'}
                </p>
              </div>

              {/* Access gating: the server rejects admin-api calls on
                  subgroups the caller isn't a member of, so docs /
                  members fetches would otherwise surface as noisy red
                  "Failed to load" errors. Intercept the access-denied
                  signal and swap the whole content area for a single
                  friendly card with a copy-your-identity affordance. */}
              {selectedFolderPerms.loading ? (
                <div className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
                  Checking access…
                </div>
              ) : selectedFolderPerms.error &&
                isAccessDeniedError(selectedFolderPerms.error) ? (
                <RestrictedFolderCard
                  folderAlias={selectedFolder.alias}
                  visibility={selectedFolder.visibility}
                  selfIdentity={selfIdentity}
                />
              ) : !selectedFolderPerms.isMember &&
                !selectedFolderPerms.error ? (
                // Caps fetch came back but we're not a member of this
                // folder subgroup — folder membership alone implies
                // read, so no membership means no access. Same UX as
                // access-denied from the user's perspective.
                <RestrictedFolderCard
                  folderAlias={selectedFolder.alias}
                  visibility={selectedFolder.visibility}
                  selfIdentity={selfIdentity}
                />
              ) : (
                <>
                  {/* Document list + sharing panel share the folder
                      pane. Clicking a doc swaps to the full-screen
                      editor via setSelectedDocId.
                      key={folderId} on both forces a remount on folder
                      switch so local state (typed alias, pending saves,
                      invite/remove errors) can't leak between folders. */}
                  <div className="rounded-lg border border-border bg-card">
                    <DocumentList
                      key={`list:${selectedFolder.id}`}
                      folderId={selectedFolder.id}
                      selectedDocId={selectedDocId}
                      onOpen={setSelectedDocId}
                    />
                  </div>

                  <FolderSharingPanel
                    key={`sharing:${selectedFolder.id}`}
                    folderId={selectedFolder.id}
                  />
                </>
              )}
            </div>
          )}
        </main>
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
