import { describe, expect, it } from 'vitest';

import { chooseAdmitter, classifyNodes, normaliseAccount, type RoutableNode } from './admission.js';


/** Assert a single-element result and return it, so tests keep their intent
 * under `noUncheckedIndexedAccess` rather than sprouting non-null assertions. */
function expectOne<T>(items: readonly T[]): T {
  expect(items).toHaveLength(1);
  const [first] = items;
  if (first === undefined) throw new Error('expected exactly one item');
  return first;
}

const node = (over: Partial<RoutableNode> = {}): RoutableNode => ({
  peerId: '12D3KooWpeer',
  account: 'aa'.repeat(32),
  relayUrl: 'https://node.example',
  admitUrl: 'https://node.example/admin-api/namespaces/ns/admit',
  fresh: true,
  canAdmit: true,
  canExecute: true,
  ...over,
});

describe('normaliseAccount', () => {
  it('strips 0x and lowercases, so spelling never reads as policy', () => {
    expect(normaliseAccount('0xAABB')).toBe('aabb');
    expect(normaliseAccount('AABB')).toBe('aabb');
  });

  it('treats empty and absent alike', () => {
    expect(normaliseAccount(null)).toBeNull();
    expect(normaliseAccount('')).toBeNull();
    expect(normaliseAccount('   ')).toBeNull();
  });
});

describe('classifyNodes', () => {
  it('matches a signed admitter whose spelling differs from the cloud’s', () => {
    const only = expectOne(classifyNodes([node({ account: '0x' + 'AA'.repeat(32) })], ['aa'.repeat(32)]));
    expect(only.admissibility.kind).toBe('usable');
  });

  it('calls a healthy node the invitation does not name what it is', () => {
    // The case the mero-js docs single out: live, listed, and a claim here is
    // still refused, because the admin never signed this account into the list.
    const only = expectOne(classifyNodes([node({ account: 'bb'.repeat(32) })], ['aa'.repeat(32)]));
    expect(only.admissibility.kind).toBe('not-invited');
  });

  it('separates “invited but down” from “not invited”', () => {
    const classified = classifyNodes(
      [
        node({ peerId: 'down', account: 'aa'.repeat(32), canAdmit: false, fresh: false }),
        node({ peerId: 'stranger', account: 'bb'.repeat(32) }),
      ],
      ['aa'.repeat(32)],
    );
    expect(classified.map((c) => c.admissibility.kind)).toEqual([
      'invited-unreachable',
      'not-invited',
    ]);
  });

  it('treats an empty signed list as the legacy “any ready peer” shape', () => {
    // Invitations minted before `admitters` existed carry none. Reading that as
    // "nobody may admit" would refuse every one of them.
    const only = expectOne(classifyNodes([node()], []));
    expect(only.admissibility.kind).toBe('usable');
  });

  it('preserves the cloud’s ordering', () => {
    const classified = classifyNodes(
      [node({ peerId: 'first' }), node({ peerId: 'second' })],
      ['aa'.repeat(32)],
    );
    expect(classified.map((c) => c.node.peerId)).toEqual(['first', 'second']);
  });
});

describe('chooseAdmitter', () => {
  it('prefers a usable node that can also execute, so one node serves both legs', () => {
    const classified = classifyNodes(
      [
        node({ peerId: 'admit-only', canExecute: false }),
        node({ peerId: 'admit-and-execute', canExecute: true }),
      ],
      ['aa'.repeat(32)],
    );
    expect(chooseAdmitter(classified).chosen?.peerId).toBe('admit-and-execute');
  });

  it('still admits through a node that cannot execute, rather than refusing', () => {
    // Admission is the step that cannot proceed without a node; relaying a join
    // the joiner already signed is not authoring on anyone's behalf.
    const classified = classifyNodes([node({ canExecute: false })], ['aa'.repeat(32)]);
    const { chosen, reason } = chooseAdmitter(classified);
    expect(chosen).not.toBeNull();
    expect(reason).toBeNull();
  });

  it('says “wait” when every invited node is down', () => {
    const classified = classifyNodes(
      [node({ canAdmit: false, fresh: false })],
      ['aa'.repeat(32)],
    );
    const { chosen, reason } = chooseAdmitter(classified);
    expect(chosen).toBeNull();
    expect(reason).toMatch(/unreachable/);
  });

  it('says “stale invitation” when only uninvited nodes are live', () => {
    const classified = classifyNodes([node({ account: 'bb'.repeat(32) })], ['aa'.repeat(32)]);
    const { chosen, reason } = chooseAdmitter(classified);
    expect(chosen).toBeNull();
    expect(reason).toMatch(/snapshot/);
  });

  it('distinguishes an empty fleet from both', () => {
    const { chosen, reason } = chooseAdmitter(classifyNodes([], ['aa'.repeat(32)]));
    expect(chosen).toBeNull();
    expect(reason).toMatch(/no nodes/);
  });
});
