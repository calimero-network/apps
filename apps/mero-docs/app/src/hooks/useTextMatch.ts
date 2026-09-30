// Which docs hold a text, answered from the text index on this device: the
// Home text filter and the saved views that carry one.

import { useMemo } from 'react';
import {
  useTextIndexValue,
  useWorkspaceIndexValue,
} from '@/context/WorkspaceIndexContext';
import type { TextMatch } from '@/lib/homeQuery';
import { docsMatchingText } from '@/lib/search/docText';

/** A matcher over the current rows and texts, each query's answer kept until either changes. */
export function useTextMatch(): TextMatch {
  const { rows } = useWorkspaceIndexValue();
  const { texts } = useTextIndexValue();
  return useMemo(() => {
    const answers = new Map<string, Set<string>>();
    return (text) => {
      let hit = answers.get(text);
      if (!hit) {
        hit = docsMatchingText(text, rows, texts);
        answers.set(text, hit);
      }
      return hit;
    };
  }, [rows, texts]);
}
