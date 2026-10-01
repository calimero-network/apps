// An emoji is two UTF-16 units: a search for one must mark the whole character,
// in a title and in a body snippet, and nothing else.

import React from 'react';
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { Highlight } from '@/components/common/Highlight';
import { searchText } from '../docText';
import { searchV1 } from '../rank';
import { rowKey, type DocText } from '../../workspaceIndex/types';
import { row } from '../../workspaceIndex/__tests__/row';

const TEXT = '🚀 launch plan';

function marks(text: string, ranges: [number, number][]): string[] {
  const { container } = render(<Highlight text={text} ranges={ranges} />);
  // <mark> has no implicit ARIA role, so only a DOM query finds it.
  // eslint-disable-next-line testing-library/no-container
  return [...container.querySelectorAll('mark')].map(
    (m) => m.textContent ?? '',
  );
}

describe('emoji search highlight', () => {
  it('marks the whole emoji in a title', () => {
    const [hit] = searchV1('🚀', [row({ docId: 'd', title: TEXT })], [], []);
    expect(hit.ranges).toEqual([[0, 2]]);
    expect(marks(TEXT, hit.ranges)).toEqual(['🚀']);
  });

  it('marks the whole emoji in a body snippet', () => {
    const doc: DocText = {
      folderId: 'f1',
      docId: 'd',
      blocks: [{ id: 'p', kind: 'paragraph', text: TEXT }],
      links: [],
      mentions: [],
    };
    const [hit] = searchText('🚀', new Map([[rowKey('f1', 'd'), doc]]));
    expect(hit.ranges).toEqual([[0, 2]]);
    expect(marks(hit.snippet, hit.ranges)).toEqual(['🚀']);
  });
});
