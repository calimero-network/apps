import { WorkspaceUpdates } from '@calimero-apps/passkey';

import { Panel } from './ui';

/** Settings "Updates": the release the open pipeline runs, a newer one when there is one, and its approval for an owner or admin. */
export default function UpdatesPanel({ appId, pipeline }: { appId: string; pipeline?: string }) {
  return (
    <Panel data-testid="updates-settings">
      <WorkspaceUpdates appId={appId} subject={pipeline ? `the pipeline ${pipeline}` : undefined} />
    </Panel>
  );
}
