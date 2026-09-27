import { describe, expect, it } from 'vitest';
import {
  docLinkCardState,
  type DocLinkCardContext,
  type DocLinkCardState,
} from '../linkTargetView';
import { rowKey } from '../workspaceIndex/types';
import { row } from '../workspaceIndex/__tests__/row';

const live = row({ folderId: 'f1', docId: 'd1', title: 'Roadmap v2' });

const ctx: DocLinkCardContext = {
  ws: 'w1',
  readableFolders: new Set(['f1', 'f2']),
  loadedFolders: new Set(['f1']),
  rows: new Map([[rowKey('f1', 'd1'), live]]),
};

describe('docLinkCardState', () => {
  it('discriminates on state, matching the card component props', () => {
    const card: DocLinkCardState = docLinkCardState(
      { ws: 'w1', folder: 'f1', doc: 'd1' },
      ctx,
    );
    expect(card.state).toBe('ok');
  });

  it('shows the current row, so a renamed target shows its new title (L-18, L-19)', () => {
    expect(
      docLinkCardState({ ws: 'w1', folder: 'f1', doc: 'd1', block: 'b' }, ctx),
    ).toEqual({ state: 'ok', row: live });
  });

  it('says deleted when the loaded folder no longer has the doc (L-20)', () => {
    expect(
      docLinkCardState({ ws: 'w1', folder: 'f1', doc: 'gone' }, ctx),
    ).toEqual({ state: 'deleted' });
  });

  it('says loading, not deleted, while the folder is still loading', () => {
    expect(
      docLinkCardState({ ws: 'w1', folder: 'f2', doc: 'd9' }, ctx),
    ).toEqual({ state: 'loading' });
  });

  it('says no access for a folder the caller cannot open (L-21)', () => {
    expect(
      docLinkCardState({ ws: 'w1', folder: 'secret', doc: 'd1' }, ctx),
    ).toEqual({ state: 'no-access' });
  });

  it('says other workspace before anything else (L-22)', () => {
    expect(
      docLinkCardState({ ws: 'w2', folder: 'f1', doc: 'd1' }, ctx),
    ).toEqual({ state: 'other-workspace' });
  });
});
