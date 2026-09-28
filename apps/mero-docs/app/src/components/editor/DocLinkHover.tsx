// A card for the doc a link points at, opened by resting the pointer on the
// link or focusing it. Touch has no hover, so a tap simply follows the link.

import * as React from 'react';
import {
  LinkToolbar,
  useBlockNoteEditor,
  type LinkToolbarProps,
} from '@blocknote/react';

import {
  useFolderPaths,
  type FolderPaths,
} from '@/components/home/useHomeChips';
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from '@/components/ui/popover';
import {
  useTextIndexValue,
  useWorkspaceIndexValue,
} from '@/context/WorkspaceIndexContext';
import { useDriveWorkspace } from '@/hooks/useDriveWorkspace';
import { usePersonName } from '@/hooks/usePersonName';
import { useTags } from '@/hooks/useTags';
import type { WorkspaceIndex } from '@/hooks/useWorkspaceIndex';
import { docLabel } from '@/lib/docLabel';
import { parseDocHref } from '@/lib/links';
import { docLinkCardState } from '@/lib/linkTargetView';
import { whenLabel } from '@/lib/relativeTime';
import {
  rowKey,
  type DocHrefTarget,
  type DocText,
  type Tag,
} from '@/lib/workspaceIndex/types';
import { DocLinkCard, type DocLinkCardProps } from './DocLinkCard';
import { docLinkAt } from './blocknote/docLinks';

const OPEN_DELAY_MS = 300; // a pointer passing over a link does not open its card
const CLOSE_GRACE_MS = 150; // time to move the pointer from the link into the card

type CardData = {
  ws: string | null | undefined;
  registryFolders: { id: string }[] | null; // every folder in the workspace; null until read
  index: Pick<
    WorkspaceIndex,
    'rows' | 'folders' | 'foldersKnown' | 'folderStatus' | 'refetchFolder'
  >;
  paths: FolderPaths;
  texts: Map<string, DocText>;
  tagsByKey: Map<string, Tag>;
  personName: (id: string) => string;
};

type OpenLink = { anchor: HTMLAnchorElement; target: DocHrefTarget };

/** What the card shows for a link target; the title is the doc's current one, not the link text. */
export function docLinkCardProps(
  target: DocHrefTarget,
  d: CardData,
  now: number,
): DocLinkCardProps {
  const { index } = d;
  const withStatus = (status: string) =>
    new Set(
      index.folders
        .filter((f) => index.folderStatus[f.id] === status)
        .map((f) => f.id),
    );
  const view = docLinkCardState(target, {
    ws: d.ws ?? null,
    existingFolders: d.registryFolders
      ? new Set(d.registryFolders.map((f) => f.id))
      : null,
    readableFolders: index.foldersKnown
      ? new Set(index.folders.map((f) => f.id))
      : null,
    failedFolders: withStatus('error'),
    loadedFolders: withStatus('ready'),
    rows: new Map(index.rows.map((r) => [rowKey(r.folderId, r.docId), r])),
  });
  if (view.state === 'unavailable') {
    return {
      state: 'unavailable',
      onRetry: () => index.refetchFolder(target.folder),
    };
  }
  if (view.state !== 'ok') return { state: view.state };
  const r = view.row;
  const path = d.paths.get(r.folderId);
  const excerpt = d.texts
    .get(rowKey(r.folderId, r.docId))
    ?.blocks.find((b) => b.text.trim())
    ?.text.trim();
  return {
    state: 'ok',
    title: docLabel(r.title),
    folderPath: path?.names ?? [],
    folderColor: path?.color,
    updatedLabel: `${whenLabel(r.updatedAt, now)} by ${d.personName(r.updatedBy)}`,
    excerpt,
    tags: r.tags.flatMap((key) => {
      const tag = d.tagsByKey.get(key);
      return tag?.deleted
        ? []
        : [{ key, name: tag?.name ?? key, color: tag?.color }];
    }),
  };
}

function LiveDocLinkCard({ target }: { target: DocHrefTarget }) {
  const index = useWorkspaceIndexValue();
  const { texts } = useTextIndexValue();
  const { byKey } = useTags();
  const { namespaceId, registryFolders } = useDriveWorkspace();
  const paths = useFolderPaths(index.folders);
  const updatedBy = index.rows.find(
    (r) => r.folderId === target.folder && r.docId === target.doc,
  )?.updatedBy;
  const personName = usePersonName(updatedBy);
  const props = docLinkCardProps(
    target,
    {
      ws: namespaceId,
      registryFolders,
      index,
      paths,
      texts,
      tagsByKey: byKey,
      personName,
    },
    Date.now(),
  );
  return <DocLinkCard {...props} />;
}

/** Wraps the editor so every doc link in it gets a hover and focus card. */
export function DocLinkHover({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState<OpenLink | null>(null);
  const timer = React.useRef<ReturnType<typeof setTimeout>>(undefined);
  const later = React.useCallback((run: () => void, ms: number) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(run, ms);
  }, []);
  const stay = () => clearTimeout(timer.current);
  const close = React.useCallback(() => {
    clearTimeout(timer.current);
    setOpen(null);
  }, []);
  React.useEffect(() => () => clearTimeout(timer.current), []);

  const show = (el: EventTarget) => {
    const link = docLinkAt(el, window.location.origin);
    if (!link) return;
    if (open?.anchor === link.anchor) stay();
    else later(() => setOpen(link), OPEN_DELAY_MS);
  };
  const leave = (el: EventTarget, to: EventTarget | null) => {
    const link = docLinkAt(el, window.location.origin);
    if (link && !(to instanceof Node && link.anchor.contains(to))) {
      later(() => setOpen(null), CLOSE_GRACE_MS);
    }
  };

  return (
    <div
      onPointerOver={(e) => e.pointerType !== 'touch' && show(e.target)}
      onPointerOut={(e) => leave(e.target, e.relatedTarget)}
      onFocus={(e) => show(e.target)}
      onBlur={(e) => leave(e.target, e.relatedTarget)}
      // The card is portalled but its React events still bubble here.
      onClick={(e) => e.currentTarget.contains(e.target as Node) && close()}
    >
      {children}
      <Popover open={!!open} onOpenChange={(next) => !next && close()}>
        <PopoverAnchor virtualRef={{ current: open?.anchor ?? null }} />
        {open && (
          <PopoverContent
            data-testid="doc-link-card"
            side="bottom"
            align="start"
            className="w-auto p-0"
            onOpenAutoFocus={(e) => e.preventDefault()}
            onCloseAutoFocus={(e) => e.preventDefault()}
            onPointerEnter={stay}
            onPointerLeave={() => later(() => setOpen(null), CLOSE_GRACE_MS)}
          >
            <LiveDocLinkCard target={open.target} />
          </PopoverContent>
        )}
      </Popover>
    </div>
  );
}

/** BlockNote's link toolbar, except on a doc link merely hovered: the card above stands in for it there. */
export function DocAwareLinkToolbar(props: LinkToolbarProps) {
  const editor = useBlockNoteEditor();
  const { from, to } = editor.prosemirrorState.selection;
  const caretInLink = from >= props.range.from && to <= props.range.to;
  if (!caretInLink && parseDocHref(props.url, window.location.origin))
    return null;
  return <LinkToolbar {...props} />;
}
