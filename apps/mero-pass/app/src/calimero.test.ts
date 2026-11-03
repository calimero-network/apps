import { describe, expect, it } from 'vitest';

import { describeTarget } from './calimero';

describe('describeTarget', () => {
  it('names merod local, a Cloud cluster, and a node reached by URL', () => {
    expect(
      describeTarget({
        kind: 'local',
        nodes: ['http://127.0.0.1:2501', 'http://127.0.0.1:2502'],
      } as never),
    ).toBe('merod local (2 nodes)');
    expect(
      describeTarget({ kind: 'cloud', cluster: 'eu-shared-1' } as never),
    ).toBe('Calimero Cloud eu-shared-1');
    expect(
      describeTarget({
        kind: 'cloud',
        cluster: 'node.example.com',
        direct: true,
        nodes: ['https://node.example.com'],
      } as never),
    ).toBe('node node.example.com');
    expect(describeTarget(null)).toBe('');
  });
});
