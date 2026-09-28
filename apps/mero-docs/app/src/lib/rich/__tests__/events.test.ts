import { describe, it, expect } from 'vitest';
import { parseRichEvents, parseMetaChanges } from '../events';

const bytes = (value: unknown) =>
  Array.from(new TextEncoder().encode(JSON.stringify(value)));

describe('parseRichEvents', () => {
  it('decodes a StateMutation batch with byte payloads', () => {
    const data = {
      newRoot: 'abc',
      events: [
        {
          kind: 'TitleChanged',
          data: bytes({ doc: 'doc-1' }),
        },
        { kind: 'BlockInserted', data: bytes({ doc: 'doc-1', block: 'blk' }) },
      ],
    };
    expect(parseRichEvents(data)).toEqual([
      { kind: 'TitleChanged', doc: 'doc-1' },
      { kind: 'BlockInserted', doc: 'doc-1' },
    ]);
  });

  it('decodes a tagged single-variant payload', () => {
    expect(
      parseRichEvents({ TextChanged: { doc: 'doc-1', block: 'blk' } }),
    ).toEqual([{ kind: 'TextChanged', doc: 'doc-1' }]);
  });

  it('decodes a mark event', () => {
    expect(
      parseRichEvents({
        MarkApplied: { doc: 'doc-1', block: 'blk', mark_id: 'mk' },
      }),
    ).toEqual([{ kind: 'MarkApplied', doc: 'doc-1' }]);
  });

  it('drops the document events this decoder does not describe', () => {
    expect(parseRichEvents({ DocCreated: { id: 'doc-1' } })).toEqual([]);
  });

  it('drops a variant whose payload is missing its document', () => {
    expect(parseRichEvents({ TitleChanged: {} })).toEqual([]);
    expect(parseRichEvents({ BlockMoved: { block: 'blk' } })).toEqual([]);
  });

  it('is empty for anything that is not an event payload', () => {
    expect(parseRichEvents(null)).toEqual([]);
    expect(parseRichEvents('TitleChanged')).toEqual([]);
    expect(parseRichEvents({ events: 'nope' })).toEqual([]);
  });

  it('skips an undecodable byte payload without losing the batch', () => {
    const data = {
      events: [
        { kind: 'TitleChanged', data: [1, 2, 3] },
        { kind: 'BlockDeleted', data: bytes({ doc: 'doc-1', block: 'blk' }) },
      ],
    };
    expect(parseRichEvents(data)).toEqual([
      { kind: 'BlockDeleted', doc: 'doc-1' },
    ]);
  });
});

describe('parseMetaChanges', () => {
  it('names the docs whose tags changed, in either payload shape', () => {
    expect(
      parseMetaChanges({
        events: [
          { kind: 'DocTagsChanged', data: bytes({ id: 'doc-1' }) },
          { kind: 'TitleChanged', data: bytes({ doc: 'doc-2' }) },
          { kind: 'DocTagsChanged', data: bytes({ id: 'doc-3' }) },
        ],
      }),
    ).toEqual(['doc-1', 'doc-3']);
    expect(parseMetaChanges({ DocTagsChanged: { id: 'doc-1' } })).toEqual([
      'doc-1',
    ]);
  });

  it('names the docs archived or unarchived', () => {
    expect(
      parseMetaChanges({
        events: [
          { kind: 'DocArchived', data: bytes({ id: 'doc-1' }) },
          { kind: 'DocUnarchived', data: bytes({ id: 'doc-2' }) },
        ],
      }),
    ).toEqual(['doc-1', 'doc-2']);
  });

  it('drops other events and a payload without an id', () => {
    expect(parseMetaChanges({ DocEdited: { id: 'doc-1' } })).toEqual([]);
    expect(parseMetaChanges({ DocTagsChanged: { doc: 'doc-1' } })).toEqual([]);
    expect(parseMetaChanges(null)).toEqual([]);
  });
});
