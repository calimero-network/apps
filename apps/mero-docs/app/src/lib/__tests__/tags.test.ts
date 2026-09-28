import { describe, expect, it } from 'vitest';
import {
  findTagByName,
  firstUnusedColor,
  isValidTagKey,
  normalizeTagName,
  sidebarTags,
  tagCounts,
  tagKeyFor,
  tagSuggestions,
  TAG_COLORS,
  TAG_COLOR_NAMES,
  TAG_NAME_MAX,
  TAG_NEUTRAL,
  type Tag,
} from '../tags';
import { row } from '../workspaceIndex/__tests__/row';

function tag(key: string, name: string, deleted = false): Tag {
  return { key, name, color: TAG_COLORS[0], deleted };
}

/** A `random` that walks through fixed values, for predictable fallback keys. */
function sequence(...values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length];
}

describe('tag constants', () => {
  it('match the palette the UI uses', () => {
    expect(TAG_COLORS).toEqual([
      '#3b82f6',
      '#8b5cf6',
      '#10b981',
      '#f59e0b',
      '#ec4899',
      '#ef4444',
      '#14b8a6',
      '#64748b',
    ]);
    expect(TAG_NEUTRAL).toBe('#94a3b8');
    expect(TAG_NAME_MAX).toBe(32);
  });

  it('names every colour, in the same order', () => {
    expect(TAG_COLOR_NAMES).toEqual([
      'Blue',
      'Purple',
      'Green',
      'Amber',
      'Pink',
      'Red',
      'Teal',
      'Slate',
    ]);
  });
});

describe('normalizeTagName (T-04)', () => {
  it('trims and collapses inner whitespace', () => {
    expect(normalizeTagName('  a   b  ')).toBe('a b');
    expect(normalizeTagName('Q3\tPlan')).toBe('Q3 Plan');
  });

  it('is empty for whitespace only', () => {
    expect(normalizeTagName('   ')).toBe('');
  });

  it('cuts to TAG_NAME_MAX characters without splitting emoji', () => {
    expect(normalizeTagName('x'.repeat(40))).toBe('x'.repeat(TAG_NAME_MAX));
    const rockets = normalizeTagName('🚀'.repeat(40));
    expect(Array.from(rockets)).toHaveLength(TAG_NAME_MAX);
    expect(rockets).toBe('🚀'.repeat(TAG_NAME_MAX));
  });

  it('does not end on a space after the cut', () => {
    expect(normalizeTagName('x'.repeat(31) + ' yz')).toBe('x'.repeat(31));
  });

  it('keeps non-latin and emoji names (S-06)', () => {
    expect(normalizeTagName('日本')).toBe('日本');
    expect(normalizeTagName('🚀 launch')).toBe('🚀 launch');
  });
});

describe('findTagByName (T-02)', () => {
  const tags = [
    tag('launch', 'launch'),
    tag('cafe', 'Café'),
    tag('old', 'Old', true),
    tag('t-abc123', '日本'),
  ];

  it('matches ignoring case, accents and extra spaces', () => {
    expect(findTagByName(tags, 'Launch')?.key).toBe('launch');
    expect(findTagByName(tags, '  CAFE ')?.key).toBe('cafe');
    expect(findTagByName(tags, '日本')?.key).toBe('t-abc123');
  });

  it('treats a word-final sigma like any other sigma', () => {
    expect(findTagByName([tag('g', 'ΟΔΟΣ')], 'οδοσ')?.key).toBe('g');
    expect(findTagByName([tag('g', 'οδοσ')], 'ΟΔΟΣ')?.key).toBe('g');
  });

  it('ignores deleted tags', () => {
    expect(findTagByName(tags, 'old')).toBeUndefined();
  });

  it('finds nothing for an unknown or empty name', () => {
    expect(findTagByName(tags, 'launc')).toBeUndefined();
    expect(findTagByName(tags, '  ')).toBeUndefined();
  });
});

describe('tagKeyFor (T-05)', () => {
  const none = new Set<string>();

  it('slugs a latin name', () => {
    expect(tagKeyFor('Q3 Plan', none)).toBe('q3-plan');
    expect(tagKeyFor('  a   b  ', none)).toBe('a-b');
    expect(tagKeyFor('Café & Co.', none)).toBe('cafe-co');
    expect(tagKeyFor('🚀 launch', none)).toBe('launch');
  });

  it('appends -2, -3 on a collision, deleted keys included (T-14)', () => {
    expect(tagKeyFor('Launch', new Set(['launch']))).toBe('launch-2');
    expect(tagKeyFor('Launch', new Set(['launch', 'launch-2']))).toBe(
      'launch-3',
    );
  });

  it('keeps room for the suffix inside the key limit', () => {
    const long = 'a'.repeat(80);
    const key = tagKeyFor(long, new Set([tagKeyFor(long, none)]));
    expect(key.endsWith('-2')).toBe(true);
    expect(isValidTagKey(key)).toBe(true);
  });

  it('falls back to t- plus six random base36 characters with no latin letters or digits', () => {
    expect(tagKeyFor('日本', none, sequence(0))).toBe('t-000000');
    expect(tagKeyFor('🚀', none, sequence(0.999))).toBe('t-zzzzzz');
  });

  it('retries the random key on a collision', () => {
    const random = sequence(...Array(6).fill(0), ...Array(6).fill(0.999));
    expect(tagKeyFor('日本', new Set(['t-000000']), random)).toBe('t-zzzzzz');
  });

  it('falls back to a numbered suffix when random keys keep colliding', () => {
    const taken = new Set(['t-000000', 't-000000-2']);
    expect(tagKeyFor('日本', taken, () => 0)).toBe('t-000000-3');
  });

  it('always produces a key the contract accepts', () => {
    for (const name of [
      'Q3 Plan',
      '日本',
      '🚀 launch',
      '---',
      'Ärger',
      'x'.repeat(32),
    ]) {
      expect(isValidTagKey(tagKeyFor(name, none))).toBe(true);
    }
  });
});

describe('isValidTagKey', () => {
  it('mirrors the contract: 1 to 64 of a-z, 0-9 and -', () => {
    expect(isValidTagKey('launch-2')).toBe(true);
    expect(isValidTagKey('a'.repeat(64))).toBe(true);
    for (const bad of ['', 'Launch', 'a b', 'a_b', 'café', 'a'.repeat(65)]) {
      expect(isValidTagKey(bad)).toBe(false);
    }
  });
});

describe('tagCounts and sidebarTags (T-16)', () => {
  const rows = [
    row({ docId: 'a', tags: ['x', 'y'] }),
    row({ docId: 'b', tags: ['y'] }),
    row({ docId: 'c', tags: ['y', 'z'], archived: true }),
  ];

  it('counts non-archived docs per tag', () => {
    expect(tagCounts(rows)).toEqual(
      new Map([
        ['x', 1],
        ['y', 2],
      ]),
    );
  });

  it('lists live tags with docs, by count then name', () => {
    const tags = [
      tag('x', 'beta'),
      tag('y', 'zeta'),
      tag('z', 'unused'),
      tag('w', 'Alpha'),
      tag('d', 'gone', true),
    ];
    const counts = new Map([
      ['x', 1],
      ['y', 2],
      ['w', 1],
      ['d', 5],
    ]);
    expect(sidebarTags(tags, counts).map((t) => t.key)).toEqual([
      'y',
      'w',
      'x',
    ]);
  });
});

describe('tagSuggestions (T-02)', () => {
  const tags = [
    tag('relaunch', 'relaunch'),
    tag('launch', 'Launch'),
    tag('launch-plan', 'launch plan'),
    tag('old', 'launched', true),
    tag('q3', 'Q3'),
  ];
  const counts = new Map([
    ['relaunch', 9],
    ['launch-plan', 5],
    ['launch', 1],
  ]);

  it('puts the exact name first, then prefixes, then the rest, busiest first', () => {
    expect(
      tagSuggestions(tags, 'launch', [], counts).map((t) => t.key),
    ).toEqual(['launch', 'launch-plan', 'relaunch']);
  });

  it('folds case and accents, and leaves out deleted tags and tags already on the doc', () => {
    expect(
      tagSuggestions(tags, 'LAÜNCH', ['launch'], counts).map((t) => t.key),
    ).toEqual(['launch-plan', 'relaunch']);
  });

  it('offers every live tag for an empty query, busiest first, and caps the list', () => {
    expect(tagSuggestions(tags, '', [], counts).map((t) => t.key)).toEqual([
      'relaunch',
      'launch-plan',
      'launch',
      'q3',
    ]);
    const many = Array.from({ length: 20 }, (_, i) => tag(`t${i}`, `t${i}`));
    expect(tagSuggestions(many, '', [], new Map())).toHaveLength(8);
  });
});

describe('firstUnusedColor', () => {
  it('is the first palette colour no live tag has, else the first colour', () => {
    const coloured = (key: string, color: string, deleted = false): Tag => ({
      key,
      name: key,
      color,
      deleted,
    });
    expect(firstUnusedColor([])).toBe(TAG_COLORS[0]);
    expect(
      firstUnusedColor([
        coloured('a', TAG_COLORS[0]),
        coloured('b', TAG_COLORS[1], true),
      ]),
    ).toBe(TAG_COLORS[1]);
    expect(
      firstUnusedColor(TAG_COLORS.map((c, i) => coloured(`k${i}`, c))),
    ).toBe(TAG_COLORS[0]);
  });
});
