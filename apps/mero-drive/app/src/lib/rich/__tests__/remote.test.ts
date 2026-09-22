import { describe, it, expect } from 'vitest';
import { remoteInline, mapScalarSelection } from '../remote';
import type { AttrSpan } from '../delta';

describe('remoteInline', () => {
  it('is null when the re-read matches what the editor holds', () => {
    const spans: AttrSpan[] = [{ text: 'hello', attributes: {} }];
    expect(remoteInline(spans, [{ text: 'hello', attributes: {} }])).toBeNull();
  });

  it('is null when only the run boundaries moved', () => {
    const prev: AttrSpan[] = [
      { text: 'he', attributes: {} },
      { text: 'llo', attributes: {} },
    ];
    expect(remoteInline(prev, [{ text: 'hello', attributes: {} }])).toBeNull();
  });

  it('returns the replacement inline content when the text changed', () => {
    const prev: AttrSpan[] = [{ text: 'hello', attributes: {} }];
    const next: AttrSpan[] = [
      { text: 'hello ', attributes: {} },
      { text: 'world', attributes: { bold: 'true' } },
    ];
    expect(remoteInline(prev, next)).toEqual([
      { type: 'text', text: 'hello ', styles: {} },
      { type: 'text', text: 'world', styles: { bold: true } },
    ]);
  });

  it('returns the replacement when only the formatting changed', () => {
    const prev: AttrSpan[] = [{ text: 'hello', attributes: {} }];
    const next: AttrSpan[] = [
      { text: 'hello', attributes: { italic: 'true' } },
    ];
    expect(remoteInline(prev, next)).toEqual([
      { type: 'text', text: 'hello', styles: { italic: true } },
    ]);
  });

  it('returns an empty replacement when the block was emptied', () => {
    expect(remoteInline([{ text: 'hello', attributes: {} }], [])).toEqual([]);
  });
});

describe('mapScalarSelection', () => {
  it('converts scalar positions to UTF-16 code units', () => {
    expect(mapScalarSelection('a\u{1F44B}b', [1, 3])).toEqual([1, 4]);
  });

  it('passes an unresolved anchor through as null', () => {
    expect(mapScalarSelection('hello', [null, 2])).toEqual([null, 2]);
  });

  it('clamps a position past the end of the re-read text', () => {
    expect(mapScalarSelection('hi', [99])).toEqual([2]);
    expect(mapScalarSelection('hi', [-3])).toEqual([0]);
  });
});
