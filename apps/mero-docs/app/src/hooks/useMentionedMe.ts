// The docs that mention you, read from the text index on this device only.

import { useMemo } from 'react';
import { useTextIndexValue } from '@/context/WorkspaceIndexContext';
import { mentionsOf } from '@/lib/search/docText';
import { useDriveWorkspace } from './useDriveWorkspace';

/** Each doc's first mention of you by rowKey; `known` once every readable folder was read in full, `failed` names the rest. */
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
  return {
    mentions,
    keys,
    known: foldersDone >= foldersTotal,
    reading: foldersDone + failed.length < foldersTotal,
    failed,
  };
}
