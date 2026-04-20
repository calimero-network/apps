import { describe, it, expect } from 'vitest';
import {
  serializeGroupInvitationPayload,
  parseGroupInvitationPayload,
} from './invitation';

describe('serializeGroupInvitationPayload', () => {
  it('produces a base64-encoded JSON string with invitation and groupAlias', () => {
    const payload = serializeGroupInvitationPayload({
      invitation: { id: 'inv-1', data: [1, 2, 3] },
      groupAlias: 'My Workspace',
    });

    const decoded = JSON.parse(atob(payload));
    expect(decoded.invitation).toEqual({ id: 'inv-1', data: [1, 2, 3] });
    expect(decoded.groupAlias).toBe('My Workspace');
  });

  it('works without groupAlias', () => {
    const payload = serializeGroupInvitationPayload({
      invitation: { id: 'inv-2' },
    });

    const decoded = JSON.parse(atob(payload));
    expect(decoded.invitation).toEqual({ id: 'inv-2' });
    expect(decoded.groupAlias).toBeUndefined();
  });
});

describe('parseGroupInvitationPayload', () => {
  it('round-trips with serializeGroupInvitationPayload', () => {
    const original = {
      invitation: { context_id: 'ctx-1', inviter_identity: 'id-1' },
      groupAlias: 'Test Group',
    };
    const encoded = serializeGroupInvitationPayload(original);
    const parsed = parseGroupInvitationPayload(encoded);

    expect(parsed.invitation).toEqual(original.invitation);
    expect(parsed.groupAlias).toBe('Test Group');
  });

  it('throws on invalid base64', () => {
    expect(() => parseGroupInvitationPayload('not-valid!!!')).toThrow(
      'Invalid invitation payload',
    );
  });

  it('throws when invitation field is missing', () => {
    const encoded = btoa(JSON.stringify({ groupAlias: 'test' }));
    expect(() => parseGroupInvitationPayload(encoded)).toThrow(
      'Missing invitation field',
    );
  });

  it('throws on non-JSON base64', () => {
    const encoded = btoa('this is not json');
    expect(() => parseGroupInvitationPayload(encoded)).toThrow(
      'Invalid invitation payload',
    );
  });
});
