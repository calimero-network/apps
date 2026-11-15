// The workspace's Trust section, for the release its registry instance runs now.

import React from 'react';
import { WorkspaceTrust } from '@calimero-apps/passkey';
import { useSession } from '@/calimero/session';
import { useDriveWorkspace } from '@/hooks/useDriveWorkspace';

export function WorkspaceTrustPanel() {
  const { registryContextId } = useDriveWorkspace();
  const { source } = useSession();
  if (!registryContextId) return null;
  return (
    <section
      aria-label="Trust"
      className="rounded-lg border border-border bg-card px-4 py-3"
    >
      <WorkspaceTrust
        appId={registryContextId}
        source={source}
        subject="this workspace's shared settings"
      />
      <p className="mt-3 text-xs text-muted-foreground">
        Open a folder to check the code its documents run on, from the node
        shield.
      </p>
    </section>
  );
}
