import { describe, expect, it } from 'vitest';

import {
  chooseAdmitter,
  chooseExecutor,
  classifyNodes,
  normaliseAccount,
  type RoutableNode,
} from './admission.js';


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

describe('chooseExecutor', () => {
  it('ignores the invitation, because admitters does not authorise authorship', () => {
    // The node that can execute is NOT one the invitation named. That is the
    // whole point: `admitters` gates admission, `CAN_AUTHOR_ON_BEHALF` gates
    // writes, and intersecting the two would discard a perfectly good relay
    // assigned after the invitation was minted.
    const uninvited = node({ peerId: 'later', account: 'cc'.repeat(32), canExecute: true });
    const { chosen, reason } = chooseExecutor([
      node({ peerId: 'invited', account: 'aa'.repeat(32), canExecute: false }),
      uninvited,
    ]);
    expect(chosen?.peerId).toBe('later');
    expect(reason).toBeNull();
  });

  it('refuses a node the write cannot actually reach', () => {
    // `canExecute` with no URL is a grant with nowhere to send it. Returning it
    // would hand `RelayClient` a `null` base URL.
    const { chosen, reason } = chooseExecutor([node({ canExecute: true, relayUrl: null })]);
    expect(chosen).toBeNull();
    expect(reason).toMatch(/no relay URL for it yet/);
  });

  it('names the governance remedy when nothing holds the grant', () => {
    // Not an error and not a retry: an admin has to sign the capability on.
    const { chosen, reason } = chooseExecutor([node({ canExecute: false })]);
    expect(chosen).toBeNull();
    expect(reason).toMatch(/CAN_AUTHOR_ON_BEHALF/);
  });

  it('distinguishes an empty fleet from an ungranted one', () => {
    const { chosen, reason } = chooseExecutor([]);
    expect(chosen).toBeNull();
    expect(reason).toMatch(/lists no nodes/);
  });

  it('can differ from the admitter, which is the case that used to misfire', () => {
    // Admit-only node first, executor second. `chooseAdmitter` must keep the
    // invited admit-only node (admission cannot proceed without one) while
    // `chooseExecutor` picks the other — previously the write leg reused the
    // admitter and posted to a node that had told us it could not execute.
    const nodes = [
      node({ peerId: 'admit-only', account: 'aa'.repeat(32), canAdmit: true, canExecute: false }),
      node({ peerId: 'executor', account: 'bb'.repeat(32), canAdmit: false, canExecute: true }),
    ];
    const admitter = chooseAdmitter(classifyNodes(nodes, ['aa'.repeat(32)]));
    const executor = chooseExecutor(nodes);
    expect(admitter.chosen?.peerId).toBe('admit-only');
    expect(executor.chosen?.peerId).toBe('executor');
  });
});
