// Feeds the editor's link click and paste handlers from the route and the index.
// A child of the editor, so an index refetch re-renders it and not the shell.

import { useMemo, type RefObject } from 'react';
import { useNavigate } from 'react-router-dom';

import { useWorkspaceIndexValue } from '@/context/WorkspaceIndexContext';
import { useAppRoute } from '@/hooks/useAppRoute';
import { useDriveWorkspace } from '@/hooks/useDriveWorkspace';
import { rowKey } from '@/lib/workspaceIndex/types';
import type { EditorLinkNav } from './docLinks';

export function DocLinkNav({ navRef }: { navRef: RefObject<EditorLinkNav> }) {
  const { namespaceId } = useDriveWorkspace();
  const { goDoc, href } = useAppRoute();
  const navigate = useNavigate();
  const { rows } = useWorkspaceIndexValue();
  const byKey = useMemo(
    () => new Map(rows.map((r) => [rowKey(r.folderId, r.docId), r])),
    [rows],
  );
  navRef.current = {
    origin: window.location.origin,
    ws: namespaceId ?? undefined,
    goDoc,
    navigate,
    href,
    rows: byKey,
  };
  return null;
}
