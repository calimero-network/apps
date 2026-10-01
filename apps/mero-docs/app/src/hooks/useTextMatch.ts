// Which docs hold a text: the Home text filter and the saved views that carry
// one. A folder whose node index answered is answered by it, every doc at
// once; any other folder, and every folder until its index answers, from the
// text this device has read (`useTextIndex`). Titles always match locally, so
// a doc renamed a moment ago is found before the index catches up.

import { useMemo } from 'react';
import {
  useTextIndexValue,
  useWorkspaceIndexValue,
} from '@/context/WorkspaceIndexContext';
import type { TextMatch } from '@/lib/homeQuery';
import { docsMatchingText } from '@/lib/search/docText';
import { rowKey } from '@/lib/workspaceIndex/types';
import { useDocMatches } from './useDocSearch';

const NO_TEXTS = new Map();

/** A matcher over the current rows and texts, each query's answer kept until either changes. */
export function useTextMatch(): TextMatch {
  const { rows } = useWorkspaceIndexValue();
  const { texts } = useTextIndexValue();
  const fromIndex = useDocMatches();
  return useMemo(() => {
    const answers = new Map<string, Set<string>>();
    return (text) => {
      let hit = answers.get(text);
      if (!hit) {
        const indexed = fromIndex(text);
        const served = indexed?.served ?? new Set<string>();
        const local = rows.filter((r) => !served.has(r.folderId));
        const byIndex = rows.filter((r) => served.has(r.folderId));
        hit = docsMatchingText(text, local, texts);
        for (const key of docsMatchingText(text, byIndex, NO_TEXTS))
          hit.add(key);
        for (const r of byIndex) {
          const key = rowKey(r.folderId, r.docId);
          if (indexed?.keys.has(key)) hit.add(key);
        }
        answers.set(text, hit);
      }
      return hit;
    };
  }, [rows, texts, fromIndex]);
}
