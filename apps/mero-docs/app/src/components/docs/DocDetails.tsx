// The open document's Details, read from the workspace and text indexes so a
// peer's edit or new link shows up here as soon as the indexes catch up.

import * as React from 'react';

import {
  useFolderPaths,
  type FolderPaths,
} from '@/components/home/useHomeChips';
import {
  useTextIndexValue,
  useWorkspaceIndexValue,
} from '@/context/WorkspaceIndexContext';
import { useAppRoute } from '@/hooks/useAppRoute';
import { useDriveWorkspace } from '@/hooks/useDriveWorkspace';
import { useNow } from '@/hooks/useNow';
import { usePersonName } from '@/hooks/usePersonName';
import { useTags } from '@/hooks/useTags';
import { backlinksTo, linksFrom } from '@/lib/backlinks';
import { docLabel } from '@/lib/docLabel';
import { folderLabel } from '@/lib/folderLabel';
import { dateLabel, updatedLabel } from '@/lib/relativeTime';
import { docTagChips } from '@/lib/tags';
import {
  rowKey,
  type DocHrefTarget,
  type IndexRow,
} from '@/lib/workspaceIndex/types';
import {
  DetailsPanel,
  DetailsSheet,
  type DetailsPanelProps,
  type LinkedFromEntry,
  type LinksToEntry,
} from './DetailsPanel';

interface Props {
  folderId: string;
  docId: string;
  /** The folder's name while the index has not listed it yet. */
  folderName?: string;
  /** Below lg the details open as a sheet over the document. */
  sheet: boolean;
  onClose: () => void;
}

type Opens = Map<string, Pick<DocHrefTarget, 'folder' | 'doc' | 'block'>>;

function linkRow(r: IndexRow, paths: FolderPaths) {
  const path = paths.get(r.folderId);
  return {
    title: docLabel(r.title),
    folderPath: path?.names ?? [],
    folderColor: path?.color,
  };
}

// Only docs in the index are listed: they are the ones this device can open.
function useLinks(ws: string, folderId: string, docId: string) {
  const { rows, folders } = useWorkspaceIndexValue();
  const { texts } = useTextIndexValue();
  const paths = useFolderPaths(folders);
  return React.useMemo(() => {
    const byKey = new Map(rows.map((r) => [rowKey(r.folderId, r.docId), r]));
    const opens: Opens = new Map();
    const linkedFrom: LinkedFromEntry[] = backlinksTo(
      { ws, folder: folderId, doc: docId },
      texts,
    ).flatMap((b) => {
      const r = byKey.get(b.row);
      if (!r) return [];
      const key = `from:${b.row}`;
      opens.set(key, { folder: r.folderId, doc: r.docId });
      return [
        {
          key,
          sentence: b.sentence,
          sentenceBold: b.sentenceBold,
          ...linkRow(r, paths),
        },
      ];
    });
    const own = texts.get(rowKey(folderId, docId));
    const linksTo: LinksToEntry[] = (own ? linksFrom(own) : []).flatMap(
      ({ target, section }) => {
        const k = rowKey(target.folder, target.doc);
        const r = target.ws === ws ? byKey.get(k) : undefined;
        if (!r) return [];
        const key = `to:${k}`;
        opens.set(key, {
          folder: r.folderId,
          doc: r.docId,
          block: target.block,
        });
        return [{ key, section, ...linkRow(r, paths) }];
      },
    );
    return {
      row: byKey.get(rowKey(folderId, docId)),
      paths,
      linkedFrom,
      linksTo,
      opens,
    };
  }, [rows, texts, paths, ws, folderId, docId]);
}

export function DocDetails({
  folderId,
  docId,
  folderName,
  sheet,
  onClose,
}: Props) {
  const { namespaceId } = useDriveWorkspace();
  const { byKey } = useTags();
  const { goDoc } = useAppRoute();
  const now = useNow();
  const { row, paths, linkedFrom, linksTo, opens } = useLinks(
    namespaceId ?? '',
    folderId,
    docId,
  );

  // One hook per author, so each one's own profile name can win.
  const creatorName = usePersonName(row?.createdBy);
  const updaterName = usePersonName(row?.updatedBy);
  const path = paths.get(folderId);
  const props: DetailsPanelProps = {
    folder: {
      name: path?.names[path.names.length - 1] ?? folderLabel(folderName),
      color: path?.color,
    },
    created: row && {
      dateLabel: dateLabel(row.createdAt, now),
      by: row.createdBy ? creatorName(row.createdBy) : undefined,
    },
    updated: row && {
      relLabel: updatedLabel(row.updatedAt, now),
      by: row.updatedBy ? updaterName(row.updatedBy) : undefined,
    },
    tags: row ? docTagChips(row.tags, byKey) : [],
    linkedFrom,
    linksTo,
    onClose,
    onOpenLink: (key) => {
      const open = opens.get(key);
      if (open) goDoc(open.folder, open.doc, { block: open.block });
    },
  };
  return sheet ? <DetailsSheet open {...props} /> : <DetailsPanel {...props} />;
}
