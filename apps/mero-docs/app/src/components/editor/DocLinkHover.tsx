// A card for the doc a link points at, or the member a mention names, opened by
// resting the pointer on the link or focusing it. Touch has no hover, so a tap
// follows a doc link; a mention opens its card on click.

import * as React from 'react';
import {
  useGroupCapabilities,
  useGroupMembers,
} from '@calimero-network/mero-react';
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
import { useAppRoute } from '@/hooks/useAppRoute';
import { useDriveWorkspace } from '@/hooks/useDriveWorkspace';
import { useFolderReach } from '@/hooks/useFolderReach';
import { usePersonName } from '@/hooks/usePersonName';
import { useTags } from '@/hooks/useTags';
import type { WorkspaceIndex } from '@/hooks/useWorkspaceIndex';
import { docLabel } from '@/lib/docLabel';
import {
  parseDocHref,
  parseMemberHref,
  type MemberHrefTarget,
} from '@/lib/links';
import { docLinkCardState } from '@/lib/linkTargetView';
import { parseGroupRole, roleDisplayLabel, workspaceRoleOf } from '@/lib/roles';
import { whenLabel } from '@/lib/relativeTime';
import {
  rowKey,
  type DocHrefTarget,
  type DocText,
  type Tag,
} from '@/lib/workspaceIndex/types';
import { DocLinkCard, type DocLinkCardProps } from './DocLinkCard';
import { MemberCard, memberCardProps } from './MemberCard';
import { docLinkAt, mentionAt } from './blocknote/docLinks';

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

type OpenLink = {
  anchor: HTMLAnchorElement;
  doc?: DocHrefTarget;
  member?: MemberHrefTarget;
};

function linkAt(el: EventTarget): OpenLink | null {
  const origin = window.location.origin;
  const doc = docLinkAt(el, origin);
  if (doc) return { anchor: doc.anchor, doc: doc.target };
  const mention = mentionAt(el, origin);
  return mention ? { anchor: mention.anchor, member: mention.target } : null;
}

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

function LiveMemberCard({ target }: { target: MemberHrefTarget }) {
  const { namespaceId } = useDriveWorkspace();
  const { route } = useAppRoute();
  const { members } = useGroupMembers(namespaceId);
  const { capabilities } = useGroupCapabilities(namespaceId, target.member);
  const name = usePersonName(target.member)(target.member);
  const canOpen = useFolderReach(route?.folder)(target.member);
  const row = members.find((m) => m.identity === target.member);
  const role = row && workspaceRoleOf(parseGroupRole(row.role), capabilities);
  const props = memberCardProps(target, {
    ws: namespaceId,
    // You are always a member, so an empty list has not been read yet.
    members: members.length ? members.map((m) => m.identity) : null,
    name,
    role: role ? roleDisplayLabel(role) : undefined,
    canOpen,
  });
  return <MemberCard {...props} />;
}

/** Wraps the editor so every doc link and mention in it gets a hover and focus card. */
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
    const link = linkAt(el);
    if (!link) return;
    if (open?.anchor === link.anchor) stay();
    else later(() => setOpen(link), OPEN_DELAY_MS);
  };
  const leave = (el: EventTarget, to: EventTarget | null) => {
    const link = linkAt(el);
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
      onClick={(e) => {
        if (!e.currentTarget.contains(e.target as Node)) return;
        const link = linkAt(e.target);
        if (link?.member) {
          clearTimeout(timer.current);
          setOpen(link);
        } else close();
      }}
    >
      {children}
      <Popover open={!!open} onOpenChange={(next) => !next && close()}>
        <PopoverAnchor virtualRef={{ current: open?.anchor ?? null }} />
        {open && (
          <PopoverContent
            data-testid={open.member ? 'member-card' : 'doc-link-card'}
            side="bottom"
            align="start"
            className="w-auto p-0"
            onOpenAutoFocus={(e) => e.preventDefault()}
            onCloseAutoFocus={(e) => e.preventDefault()}
            onPointerEnter={stay}
            onPointerLeave={() => later(() => setOpen(null), CLOSE_GRACE_MS)}
          >
            {open.member ? (
              <LiveMemberCard target={open.member} />
            ) : (
              open.doc && <LiveDocLinkCard target={open.doc} />
            )}
          </PopoverContent>
        )}
      </Popover>
    </div>
  );
}

/** BlockNote's link toolbar, except on a doc link merely hovered and on any mention: the card above stands in for it there. */
export function DocAwareLinkToolbar(props: LinkToolbarProps) {
  const editor = useBlockNoteEditor();
  const { from, to } = editor.prosemirrorState.selection;
  const caretInLink = from >= props.range.from && to <= props.range.to;
  const origin = window.location.origin;
  // A mention's Open would leave the doc for a member URL no page shows.
  if (parseMemberHref(props.url, origin)) return null;
  if (!caretInLink && parseDocHref(props.url, origin)) return null;
  return <LinkToolbar {...props} />;
}
