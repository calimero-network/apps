import { describe, expect, it } from 'vitest';
import type { Block } from '@/generated/docs/DocsClient';
import { docTextFromBlocks, searchText } from '../docText';
import { rowKey, type DocText } from '../../workspaceIndex/types';

const ORIGIN = 'http://localhost:5173';
const LINK = '/app/w1/f/f2/d/target';
// eslint-disable-next-line no-script-url -- a hostile href the parser must reject
const SCRIPT_HREF = 'javascript:alert(1)';

function block(
  id: string,
  kind: string,
  ...spans: (string | [string, Record<string, string>])[]
): Block {
  return {
    id,
    kind,
    depth: 0,
    attrs: {},
    spans: spans.map((s) =>
      typeof s === 'string'
        ? { text: s, attributes: {} }
        : { text: s[0], attributes: s[1] },
    ),
  };
}

function text(folderId: string, docId: string, blocks: Block[]): DocText {
  return docTextFromBlocks(folderId, docId, blocks, ORIGIN);
}

function index(...texts: DocText[]): Map<string, DocText> {
  return new Map(texts.map((t) => [rowKey(t.folderId, t.docId), t]));
}

function highlighted(hit: { snippet: string; ranges: [number, number][] }) {
  return hit.ranges.map(([a, b]) => hit.snippet.slice(a, b));
}

describe('docTextFromBlocks', () => {
  it('joins span text and carries the nearest heading forward', () => {
    const t = text('f1', 'd1', [
      block('p0', 'paragraph', 'Intro ', ['bold', { bold: 'true' }]),
      block('h1', 'heading', 'Versioning'),
      block('p1', 'paragraph', 'Semver rules'),
      block('h2', 'heading', 'Release'),
      block('p2', 'bullet', 'Tag it'),
      block('h3', 'heading', ''),
      block('p3', 'paragraph', 'After a blank heading'),
    ]);
    expect(t.folderId).toBe('f1');
    expect(t.docId).toBe('d1');
    expect(t.blocks).toEqual([
      { id: 'p0', kind: 'paragraph', text: 'Intro bold' },
      { id: 'h1', kind: 'heading', text: 'Versioning', heading: 'Versioning' },
      {
        id: 'p1',
        kind: 'paragraph',
        text: 'Semver rules',
        heading: 'Versioning',
      },
      { id: 'h2', kind: 'heading', text: 'Release', heading: 'Release' },
      { id: 'p2', kind: 'bullet', text: 'Tag it', heading: 'Release' },
      { id: 'h3', kind: 'heading', text: '' },
      { id: 'p3', kind: 'paragraph', text: 'After a blank heading' },
    ]);
  });

  it('turns a doc link span into a link with its sentence and section', () => {
    const t = text('f1', 'd1', [
      block('h', 'heading', 'Plan'),
      block(
        'p',
        'paragraph',
        'First one. See ',
        ['Roadmap', { link: `${LINK}#b=b7` }],
        ' here! Last?',
      ),
    ]);
    expect(t.links).toEqual([
      {
        target: { ws: 'w1', folder: 'f2', doc: 'target', block: 'b7' },
        blockId: 'p',
        sentence: 'See Roadmap here!',
        linkRange: [4, 11],
        section: 'Plan',
      },
    ]);
  });

  it('treats neighbouring spans with the same link as one link', () => {
    const t = text('f1', 'd1', [
      block(
        'p',
        'paragraph',
        ['Road', { link: LINK }],
        ['map', { link: LINK, bold: 'true' }],
        ' then ',
        ['again', { link: LINK }],
      ),
    ]);
    expect(t.links.map((l) => l.linkRange)).toEqual([
      [0, 7],
      [13, 18],
    ]);
  });

  it('ignores links that are not Mero Docs doc links', () => {
    const t = text('f1', 'd1', [
      block(
        'p',
        'paragraph',
        ['site', { link: 'https://example.com' }],
        ['folder', { link: '/app/w1/f/f2' }],
        ['bad', { link: SCRIPT_HREF }],
      ),
    ]);
    expect(t.links).toEqual([]);
  });

  it('cuts a long sentence to 160 characters around the link', () => {
    const long = 'word '.repeat(60);
    const t = text('f1', 'd1', [
      block('p', 'paragraph', long, ['Target', { link: LINK }], ' ' + long),
    ]);
    const [link] = t.links;
    expect(link.sentence.length).toBeLessThanOrEqual(160);
    expect(link.sentence.startsWith('…')).toBe(true);
    expect(link.sentence.endsWith('…')).toBe(true);
    expect(link.sentence.slice(...link.linkRange)).toBe('Target');
  });

  it('has no section before the first heading', () => {
    const t = text('f1', 'd1', [
      block('p', 'paragraph', ['Target', { link: LINK }]),
    ]);
    expect(t.links[0].section).toBeUndefined();
    expect(t.links[0].sentence).toBe('Target');
  });
});

describe('searchText', () => {
  const versioning = text('f1', 'semver', [
    block('h', 'heading', 'Versioning'),
    block('p1', 'paragraph', 'We bump the major on breaking changes.'),
  ]);

  it('finds body text with the nearest heading and a highlighted snippet (S-13)', () => {
    const [hit] = searchText('breaking', index(versioning));
    expect(hit).toEqual({
      row: 'f1/semver',
      blockId: 'p1',
      heading: 'Versioning',
      snippet: 'We bump the major on breaking changes.',
      ranges: [[21, 29]],
    });
  });

  it('finds text inside a heading or a link (S-14)', () => {
    const linked = text('f1', 'links', [
      block('p', 'paragraph', 'See ', ['Quarterly roadmap', { link: LINK }]),
    ]);
    expect(searchText('versioning', index(versioning))[0].blockId).toBe('h');
    const [hit] = searchText('quarterly', index(linked));
    expect(hit.snippet).toBe('See Quarterly roadmap');
    expect(highlighted(hit)).toEqual(['Quarterly']);
  });

  it('returns one row per doc, from its best block (S-15)', () => {
    const t = text('f1', 'many', [
      block('a', 'paragraph', 'railroad'),
      block('b', 'paragraph', 'the road'),
      block('c', 'paragraph', 'road ahead'),
      block('d', 'paragraph', 'road again'),
    ]);
    const hits = searchText('road', index(t));
    expect(hits.map((h) => h.blockId)).toEqual(['c']);
  });

  it('orders docs by their best match', () => {
    const sub = text('f1', 'sub', [block('a', 'paragraph', 'railroad')]);
    const pre = text('f1', 'pre', [block('a', 'paragraph', 'road')]);
    expect(searchText('road', index(sub, pre)).map((h) => h.row)).toEqual([
      'f1/pre',
      'f1/sub',
    ]);
  });

  it('finds an untitled doc by its body (S-22)', () => {
    const t = text('f1', 'untitled', [block('p', 'paragraph', 'orphan notes')]);
    expect(searchText('orphan', index(t)).map((h) => h.row)).toEqual([
      'f1/untitled',
    ]);
  });

  it('windows a long block around the first match', () => {
    const body = 'lorem ipsum '.repeat(20) + 'needle' + ' dolor sit'.repeat(20);
    const t = text('f1', 'long', [block('p', 'paragraph', body)]);
    const [hit] = searchText('needle', index(t));
    expect(hit.snippet.length).toBeLessThanOrEqual(90);
    expect(hit.snippet.startsWith('…')).toBe(true);
    expect(hit.snippet.endsWith('…')).toBe(true);
    expect(highlighted(hit)).toEqual(['needle']);
    const [[from]] = hit.ranges;
    expect(Math.abs(from - (hit.snippet.length - 6) / 2)).toBeLessThan(3);
  });

  it('clips a match longer than the snippet to the snippet body', () => {
    const body = 'a'.repeat(50) + 'b'.repeat(100) + 'c'.repeat(50);
    const t = text('f1', 'wide', [block('p', 'paragraph', body)]);
    const hit = searchText('b'.repeat(100), index(t))[0];
    expect(hit.snippet).toBe(`…${'b'.repeat(88)}…`);
    expect(hit.ranges).toEqual([[1, 89]]);
  });

  it('keeps every match inside the snippet and clips the rest', () => {
    const body = 'needle ' + 'x'.repeat(200) + ' needle';
    const t = text('f1', 'ends', [block('p', 'paragraph', body)]);
    const [hit] = searchText('needle', index(t));
    expect(hit.snippet.startsWith('needle')).toBe(true);
    expect(highlighted(hit)).toEqual(['needle']);
  });

  it('highlights a match at the very start of a short block that begins with …', () => {
    const t = text('f1', 'dots', [block('p', 'paragraph', '…needle')]);
    expect(highlighted(searchText('…needle', index(t))[0])).toEqual([
      '…needle',
    ]);
  });

  it('never cuts an emoji in half at a window edge', () => {
    for (let pad = 0; pad < 4; pad++) {
      const body =
        '🚀'.repeat(60) + 'x'.repeat(pad) + ' needle ' + '🚀'.repeat(60);
      const t = text('f1', `e${pad}`, [block('p', 'paragraph', body)]);
      const { snippet } = searchText('needle', index(t))[0];
      expect(snippet).toBe(Array.from(snippet).join(''));
      expect(/[\ud800-\udfff]/.test(snippet.replace(/🚀/g, ''))).toBe(false);
    }
  });

  it('highlights whole characters through accents and emoji', () => {
    const t = text('f1', 'cv', [block('p', 'paragraph', '🚀 Mon Résumé')]);
    expect(highlighted(searchText('resume', index(t))[0])).toEqual(['Résumé']);
  });

  it('returns nothing for an empty or tags-only query', () => {
    expect(searchText('  ', index(versioning))).toEqual([]);
    expect(searchText('#breaking', index(versioning))).toEqual([]);
  });

  it('stops at the limit', () => {
    const texts = Array.from({ length: 30 }, (_, i) =>
      text('f1', `d${i}`, [block('p', 'paragraph', 'shared words')]),
    );
    expect(searchText('shared', index(...texts))).toHaveLength(20);
    expect(searchText('shared', index(...texts), 3)).toHaveLength(3);
  });

  it('answers over 500 docs of 20 blocks in under 250 ms (L-S4)', () => {
    const words = [
      'alpha',
      'beta',
      'gamma',
      'delta',
      'epsilon',
      'Résumé',
      '日本',
    ];
    const texts = Array.from({ length: 500 }, (_, d) =>
      text(
        `f${d % 10}`,
        `d${d}`,
        Array.from({ length: 20 }, (_, b) =>
          block(
            `b${b}`,
            b % 5 === 0 ? 'heading' : 'paragraph',
            Array.from(
              { length: 12 },
              (_, w) => words[(d + b + w) % words.length],
            ).join(' '),
          ),
        ),
      ),
    );
    const all = index(...texts);
    searchText('warm', all);
    const started = performance.now();
    const hits = searchText('resume', all);
    const elapsed = performance.now() - started;
    expect(hits).toHaveLength(20);
    expect(elapsed).toBeLessThan(250);
  });
});
