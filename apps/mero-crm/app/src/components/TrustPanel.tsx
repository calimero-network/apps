import type { AppSource } from '@calimero-apps/connect';
import { WorkspaceTrust } from '@calimero-apps/passkey';

import { Panel } from './ui';

/** Settings "Trust": the shared review of the release the open pipeline runs. */
export default function TrustPanel({ appId, source, pipeline }: { appId: string; source: AppSource; pipeline?: string }) {
  return (
    <Panel data-testid="trust-settings">
      <WorkspaceTrust appId={appId} source={source} subject={pipeline ? `the pipeline ${pipeline}` : undefined} />
    </Panel>
  );
}
