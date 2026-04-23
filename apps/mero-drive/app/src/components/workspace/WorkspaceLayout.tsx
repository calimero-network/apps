// Three-pane workspace shell:
//   - top bar (logo + NamespaceSwitcher + user menu placeholder)
//   - left rail (FolderTree)
//   - main content (empty for Phase 8A; DocumentList + Editor land
//     in Phase 8D)
//
// Mounted by App.tsx on the /app/* route, replacing the earlier
// WorkspacePlaceholder. Providers (WorkspaceProvider, RegistryProvider,
// MeroProvider) are already in place in index.tsx.

import React from 'react';
import { LogoWithText } from '@/components/icons/Logo';
import { NamespaceSwitcher } from './NamespaceSwitcher';
import { FolderTree } from '@/components/folders/FolderTree';
import { useWorkspace } from '@/context/WorkspaceContext';
import { useRegistry } from '@/context/RegistryContext';

export function WorkspaceLayout() {
  const { namespaceId, selectedFolderId } = useWorkspace();
  const { folders } = useRegistry();
  const selectedFolder = folders.find((f) => f.id === selectedFolderId);

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
            // Phase 8-D slots the DocumentList + DocumentEditor here.
            <EmptyState
              title={selectedFolder.alias}
              body="Document list coming in Phase 8-D."
            />
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
