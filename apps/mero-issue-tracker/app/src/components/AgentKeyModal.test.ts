import { describe, expect, it } from 'vitest';

import { mcpEnv } from './AgentKeyModal';

describe('mcpEnv', () => {
  it('points the MCP server at the local nodes and the dev bundle', () => {
    expect(mcpEnv({ kind: 'local', nodes: ['http://127.0.0.1:2501', 'http://127.0.0.1:2502'] }, 'k', 'org-1', 'b-1')).toBe(
      [
        'CALIMERO_TARGET=local',
        'CALIMERO_NODES=http://127.0.0.1:2501,http://127.0.0.1:2502',
        'TRACKER_BUNDLE=b-1',
        'CALIMERO_API_KEY=k',
        'TRACKER_WORKSPACE=org-1',
      ].join('\n'),
    );
  });

  it('points it at the Cloud cluster by name with the release floor', () => {
    expect(mcpEnv({ kind: 'cloud', cluster: 'eu-1', minReleaseVersion: '2.3.109' }, 'k', 'org-1')).toBe(
      ['CALIMERO_TARGET=cloud', 'CALIMERO_CLUSTER=eu-1', 'CALIMERO_MIN_RELEASE=2.3.109', 'CALIMERO_API_KEY=k', 'TRACKER_WORKSPACE=org-1'].join('\n'),
    );
  });

  it('points it at an attested node by URL, with the release floor', () => {
    expect(
      mcpEnv(
        { kind: 'cloud', direct: true, cluster: 'node.example', nodes: ['https://node.example'], minReleaseVersion: '2.3.109' },
        'k',
        'org-1',
      ),
    ).toBe(
      ['CALIMERO_TARGET=node', 'CALIMERO_NODES=https://node.example', 'CALIMERO_MIN_RELEASE=2.3.109', 'CALIMERO_API_KEY=k', 'TRACKER_WORKSPACE=org-1'].join('\n'),
    );
  });
});
