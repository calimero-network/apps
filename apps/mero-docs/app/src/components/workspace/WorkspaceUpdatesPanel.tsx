// The workspace's Updates section, for the release its registry instance runs.

import React from 'react';
import { WorkspaceUpdates } from '@calimero-apps/passkey';
import { useDriveWorkspace } from '@/hooks/useDriveWorkspace';

export function WorkspaceUpdatesPanel() {
  const { registryContextId } = useDriveWorkspace();
  if (!registryContextId) return null;
  return (
    <section
      aria-label="Updates"
      className="rounded-lg border border-border bg-card px-4 py-3"
    >
      <WorkspaceUpdates
        appId={registryContextId}
        subject="this workspace's shared settings"
      />
    </section>
  );
}
