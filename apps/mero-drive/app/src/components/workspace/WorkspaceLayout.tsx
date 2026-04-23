// Three-pane workspace shell:
//   - top bar (logo + NamespaceSwitcher)
//   - left rail (FolderTree)
//   - main content: folder view (breadcrumb + header + doc list +
//     sharing) when a folder is selected; full-screen DocumentEditor
//     when a doc is open.
//
// Mounted by App.tsx on the /app/* route. Providers
// (WorkspaceProvider, RegistryProvider, MeroProvider) are already in
// place in index.tsx.
//
// Selected-document state is intentionally local: no other consumer
// reads it, and keeping it out of WorkspaceContext avoids unwiring a
// folder's active doc on every RegistryProvider re-render.

import React, { useState } from 'react';
import { LogoWithText } from '@/components/icons/Logo';
import { NamespaceSwitcher } from './NamespaceSwitcher';
import { FolderTree } from '@/components/folders/FolderTree';
import { FolderBreadcrumb } from '@/components/folders/FolderBreadcrumb';
import { FolderSharingPanel } from '@/components/folders/FolderSharingPanel';
import { DocumentList } from '@/components/docs/DocumentList';
import { DocumentEditor } from '@/components/docs/DocumentEditor';
import { useWorkspace } from '@/context/WorkspaceContext';
import { useRegistry } from '@/context/RegistryContext';

export function WorkspaceLayout() {
  const { namespaceId, selectedFolderId } = useWorkspace();
  const { folders } = useRegistry();
  const selectedFolder = folders.find((f) => f.id === selectedFolderId);

  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);

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
      </header>

      {/* Main grid */}
      <div className="flex flex-1">
        <aside className="w-64 shrink-0 border-r border-border bg-muted/20">
          <FolderTree />
        </aside>

        <main className="flex-1 overflow-y-auto">
          {!namespaceId ? (
            <EmptyState
              title="No workspace selected"
              body="Create or pick a workspace from the top bar to see your folders."
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
                    : 'Inherits members from the parent folder'}
                </p>
              </div>

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
