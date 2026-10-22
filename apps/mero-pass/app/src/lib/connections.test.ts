import { describe, expect, it } from 'vitest';

import type { Secret } from '@calimero-network/mero-pass';
import {
  AGENT_TAG,
  ANY_MODEL_TAG,
  connectionDraft,
  existingConnection,
  SERVICES,
} from './connections';

const x = SERVICES.find((s) => s.id === 'x')!;
const keys = {
  api_key: ' ck ',
  api_secret: 'cs',
  access_token: 'at',
  access_token_secret: 'ats',
};

const secret = (over: Partial<Secret>): Secret =>
  ({
    id: 's1',
    kind: 'api_key',
    name: 'X',
    tags: [AGENT_TAG],
    fields: { service: 'X' },
    trashed: false,
    unreadable: false,
    ...over,
  }) as Secret;

describe('connections', () => {
  it('saves X as an api_key secret mero-bot finds by its tag and service', () => {
    expect(connectionDraft(x, keys, false)).toEqual({
      kind: 'api_key',
      name: 'X',
      tags: [AGENT_TAG],
      fields: {
        service: 'X',
        api_key: 'ck',
        api_secret: 'cs',
        access_token: 'at',
        access_token_secret: 'ats',
      },
    });
    expect(connectionDraft(x, keys, true).tags).toEqual([
      AGENT_TAG,
      ANY_MODEL_TAG,
    ]);
  });

  it('names a missing key', () => {
    expect(() =>
      connectionDraft(x, { ...keys, access_token: ' ' }, false),
    ).toThrow('Access token is missing.');
  });

  it('finds the connection already saved, and only a live, tagged one', () => {
    expect(existingConnection([secret({})], x)?.id).toBe('s1');
    expect(existingConnection([secret({ fields: {}, name: 'x' })], x)?.id).toBe(
      's1',
    );
    expect(existingConnection([secret({ tags: [] })], x)).toBeUndefined();
    expect(existingConnection([secret({ trashed: true })], x)).toBeUndefined();
    expect(existingConnection([secret({ kind: 'login' })], x)).toBeUndefined();
  });
});
