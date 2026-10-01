import { describe, it, expect } from 'vitest';
import { applyChanges, moveInserts, transform, transformPosition } from '../ot';
import type { AttrSpan, Change } from '../delta';

const plain = (text: string): AttrSpan[] => [{ text, attributes: {} }];
const textOf = (spans: AttrSpan[]) => spans.map((s) => s.text).join('');
const EMOJI = String.fromCodePoint(0x1f600);

describe('applyChanges', () => {
  it('inserts, deletes and retains by scalar position', () => {
    const ops: Change[] = [{ retain: 3 }, { insert: ' red' }, { retain: 1 }, { delete: 3 }];
    expect(textOf(applyChanges(plain('The fox.'), ops))).toBe('The red .');
  });

  it('gives an insert exactly the attributes it carries', () => {
    const ops: Change[] = [{ retain: 3 }, { insert: 'X', attributes: { bold: 'true' } }];
    expect(applyChanges(plain('abcdef'), ops)).toEqual([
      { text: 'abc', attributes: {} },
      { text: 'X', attributes: { bold: 'true' } },
      { text: 'def', attributes: {} },
    ]);
  });

  it('sets and removes marks on a retain, null meaning remove', () => {
    const bold: AttrSpan[] = [{ text: 'abcd', attributes: { bold: 'true' } }];
    const ops: Change[] = [{ retain: 2, attributes: { bold: null, italic: 'true' } }];
    expect(applyChanges(bold, ops)).toEqual([
      { text: 'ab', attributes: { italic: 'true' } },
      { text: 'cd', attributes: { bold: 'true' } },
    ]);
  });

  it('counts an astral character as one position', () => {
    const ops: Change[] = [{ retain: 2 }, { insert: 'X' }];
    expect(textOf(applyChanges(plain(`a${EMOJI}b`), ops))).toBe(`a${EMOJI}Xb`);
  });
});

describe('transform', () => {
  const a: Change[] = [{ retain: 3 }, { insert: 'AAA' }];
  const b: Change[] = [{ retain: 3 }, { insert: 'BBB' }];

  it('puts the prioritised insert first when both insert at one spot', () => {
    expect(transform(a, b, true)).toEqual([{ retain: 6 }, { insert: 'BBB' }]);
    expect(transform(a, b, false)).toEqual([{ retain: 3 }, { insert: 'BBB' }]);
  });

  it('moves an insert left past text a concurrent delete removed', () => {
    const del: Change[] = [{ retain: 1 }, { delete: 3 }];
    const ins: Change[] = [{ retain: 5 }, { insert: 'X' }];
    expect(transform(del, ins, true)).toEqual([{ retain: 2 }, { insert: 'X' }]);
  });

  it('deletes only what an overlapping concurrent delete left behind', () => {
    const first: Change[] = [{ retain: 1 }, { delete: 3 }];
    const second: Change[] = [{ retain: 2 }, { delete: 3 }];
    expect(transform(first, second, true)).toEqual([{ retain: 1 }, { delete: 1 }]);
  });

  it('lets the prioritised side win a conflicting mark', () => {
    const bold: Change[] = [{ retain: 3, attributes: { bold: 'true' } }];
    const unbold: Change[] = [{ retain: 3, attributes: { bold: null } }];
    expect(transform(bold, unbold, true)).toEqual([]);
    expect(transform(bold, unbold, false)).toEqual([
      { retain: 3, attributes: { bold: null } },
    ]);
  });

  it('converges: either order of two concurrent edits gives one text', () => {
    const base = plain('The fox.');
    const alice: Change[] = [{ retain: 8 }, { insert: ' alice' }];
    const bob: Change[] = [{ insert: 'bob ' }, { retain: 4 }, { delete: 4 }];
    const viaAlice = applyChanges(applyChanges(base, alice), transform(alice, bob, true));
    const viaBob = applyChanges(applyChanges(base, bob), transform(bob, alice, false));
    expect(textOf(viaAlice)).toBe('bob The  alice');
    expect(textOf(viaBob)).toBe('bob The  alice');
  });
});

describe('transformPosition', () => {
  it('shifts a caret right past an insert before it', () => {
    expect(transformPosition([{ retain: 2 }, { insert: 'XYZ' }], 5)).toBe(8);
  });

  it('keeps a caret before an insert landing exactly on it', () => {
    expect(transformPosition([{ retain: 5 }, { insert: 'XYZ' }], 5)).toBe(5);
  });

  it('pulls a caret left past a delete before it, clamping inside one', () => {
    expect(transformPosition([{ retain: 1 }, { delete: 3 }], 6)).toBe(3);
    expect(transformPosition([{ retain: 1 }, { delete: 3 }], 2)).toBe(1);
  });
});

describe('moveInserts', () => {
  it('moves a change\'s inserts to another position and reports where they end', () => {
    expect(moveInserts([{ retain: 2 }, { insert: '\u{1F600}b' }], 5)).toEqual({
      ops: [{ retain: 5 }, { insert: '\u{1F600}b' }],
      end: 7,
    });
    expect(moveInserts([{ retain: 2 }, { insert: 'x' }], 0)).toEqual({ ops: [{ insert: 'x' }], end: 1 });
  });
});
