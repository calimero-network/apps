// The docs that mention you, read from the text index on this device only.

import { useMemo } from 'react';
import { useTextIndexValue } from '@/context/WorkspaceIndexContext';
import { mentionsOf } from '@/lib/search/docText';
import { useDriveWorkspace } from './useDriveWorkspace';

/** Each doc's first mention of you by rowKey, and whether every readable folder has been read for them. */
export function useMentionedMe() {
  const { texts, foldersDone, foldersTotal, failed } = useTextIndexValue();
  const { namespaceId, selfIdentity } = useDriveWorkspace();
  const mentions = useMemo(
    () =>
      namespaceId && selfIdentity
        ? mentionsOf(texts, namespaceId, selfIdentity)
        : new Map<string, never>(),
    [texts, namespaceId, selfIdentity],
  );
  const keys = useMemo(() => new Set(mentions.keys()), [mentions]);
  // A failed folder is not waited on; the palette and Home name it instead.
  return { mentions, keys, known: foldersDone + failed.length >= foldersTotal };
}
