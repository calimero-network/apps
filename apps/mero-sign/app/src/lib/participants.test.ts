import { describe, expect, it } from 'vitest';
import { PermissionLevel, type ParticipantInfo } from '../api/clientApi';
import {
  buildRoster,
  canRemove,
  isAdmin,
  isHexId,
  levelChangesFor,
  rankOf,
  shortId,
  toHexId,
} from './participants';

const ALICE = 'a0'.repeat(32);
const BOB = 'b0'.repeat(32);
const CARE = 'c0'.repeat(32);

function p(id: string, level: PermissionLevel): ParticipantInfo {
  return { user_id: id, permission_level: level };
}

describe('toHexId', () => {
  // The contract returns `UserId = [u8; 32]` as a byte array, and its parsers
  // take hex. The panel used to base58-encode it, so nothing on screen could be
  // pasted back into the app.
  it('hex-encodes the byte array the contract returns', () => {
    expect(toHexId([0x0a, 0xff, 0x00, 0x10])).toBe('0aff0010');
  });

  it('pads single-digit bytes', () => {
    expect(toHexId([1, 2, 3])).toBe('010203');
  });

  it('passes a string through, normalised', () => {
    expect(toHexId('  AABB  ')).toBe('aabb');
  });

  it('accepts a Uint8Array', () => {
    expect(toHexId(new Uint8Array([0xde, 0xad]))).toBe('dead');
  });
});

describe('isHexId', () => {
  it('accepts a 32-byte hex id', () => {
    expect(isHexId(ALICE)).toBe(true);
    expect(isHexId(ALICE.toUpperCase())).toBe(true);
  });

  it('rejects base58, which is what the old UI displayed', () => {
    expect(isHexId('GXtgv6t5u8QwtXGcxYHvDbEge7EHo1ewupnrmWnAKamo')).toBe(false);
  });

  it('rejects the wrong length', () => {
    expect(isHexId('aabb')).toBe(false);
    expect(isHexId(ALICE + 'aa')).toBe(false);
  });
});

describe('shortId', () => {
  it('keeps both ends so two ids stay distinguishable', () => {
    expect(shortId(ALICE)).toBe('a0a0a0a0…a0a0a0');
    expect(shortId(ALICE)).not.toBe(shortId(BOB));
  });

  it('leaves a short value alone', () => {
    expect(shortId('abcd')).toBe('abcd');
  });
});

describe('rankOf', () => {
  it('matches the contract: Admin > Sign > Read', () => {
    expect(rankOf(PermissionLevel.Admin)).toBeGreaterThan(
      rankOf(PermissionLevel.Sign),
    );
    expect(rankOf(PermissionLevel.Sign)).toBeGreaterThan(
      rankOf(PermissionLevel.Read),
    );
  });
});

describe('levelChangesFor', () => {
  // Levels are AccessControl grants in the contract, so a demotion converges
  // like a promotion and both are offered.
  it('offers every other level, lowest first', () => {
    expect(levelChangesFor(PermissionLevel.Read)).toEqual([
      PermissionLevel.Sign,
      PermissionLevel.Admin,
    ]);
    expect(levelChangesFor(PermissionLevel.Sign)).toEqual([
      PermissionLevel.Read,
      PermissionLevel.Admin,
    ]);
    expect(levelChangesFor(PermissionLevel.Admin)).toEqual([
      PermissionLevel.Read,
      PermissionLevel.Sign,
    ]);
  });
});

describe('buildRoster', () => {
  it('sorts admins first, then signers, then readers', () => {
    const roster = buildRoster(
      [
        p(CARE, PermissionLevel.Read),
        p(BOB, PermissionLevel.Admin),
        p(ALICE, PermissionLevel.Sign),
      ],
      '',
    );
    expect(roster.map((r) => r.level)).toEqual([
      PermissionLevel.Admin,
      PermissionLevel.Sign,
      PermissionLevel.Read,
    ]);
  });

  it('marks the caller, by ACCOUNT id', () => {
    const roster = buildRoster(
      [p(ALICE, PermissionLevel.Admin), p(BOB, PermissionLevel.Sign)],
      ALICE,
    );
    expect(roster.find((r) => r.id === ALICE)?.isSelf).toBe(true);
    expect(roster.find((r) => r.id === BOB)?.isSelf).toBe(false);
  });

  it('marks nobody when the contract has not said who we are', () => {
    // "" is what `whoami()` gives before it answers, and on a node running a
    // bundle from before the method existed. Badging the wrong row would be
    // worse than badging none.
    const roster = buildRoster([p(ALICE, PermissionLevel.Admin)], '');
    expect(roster.every((r) => !r.isSelf)).toBe(true);
  });

  it('hex-encodes byte-array ids from the contract', () => {
    const roster = buildRoster(
      [p([0xaa, 0xbb] as unknown as string, PermissionLevel.Sign)],
      '',
    );
    expect(roster[0].id).toBe('aabb');
  });

  it('is stable for equal levels', () => {
    const rows = [p(BOB, PermissionLevel.Sign), p(ALICE, PermissionLevel.Sign)];
    expect(buildRoster(rows, '').map((r) => r.id)).toEqual([ALICE, BOB]);
  });
});

describe('isAdmin', () => {
  const roster = buildRoster(
    [p(ALICE, PermissionLevel.Admin), p(BOB, PermissionLevel.Sign)],
    '',
  );

  it('is true only for an account holding Admin', () => {
    expect(isAdmin(roster, ALICE)).toBe(true);
    expect(isAdmin(roster, BOB)).toBe(false);
  });

  it('is false for an unknown account and for no account at all', () => {
    expect(isAdmin(roster, CARE)).toBe(false);
    expect(isAdmin(roster, '')).toBe(false);
  });
});

describe('canRemove', () => {
  it('never offers removing yourself', () => {
    // There may be no admin left to undo it: `add_participant` needs one.
    const roster = buildRoster(
      [p(ALICE, PermissionLevel.Admin), p(BOB, PermissionLevel.Admin)],
      ALICE,
    );
    const me = roster.find((r) => r.isSelf)!;
    expect(canRemove(roster, me)).toBe(false);
  });

  it('never offers removing the last admin', () => {
    const roster = buildRoster(
      [p(ALICE, PermissionLevel.Admin), p(BOB, PermissionLevel.Sign)],
      BOB,
    );
    const onlyAdmin = roster.find((r) => r.id === ALICE)!;
    expect(canRemove(roster, onlyAdmin)).toBe(false);
  });

  it('offers removing another admin when one would remain', () => {
    const roster = buildRoster(
      [
        p(ALICE, PermissionLevel.Admin),
        p(BOB, PermissionLevel.Admin),
        p(CARE, PermissionLevel.Sign),
      ],
      ALICE,
    );
    expect(canRemove(roster, roster.find((r) => r.id === BOB)!)).toBe(true);
    expect(canRemove(roster, roster.find((r) => r.id === CARE)!)).toBe(true);
  });
});
