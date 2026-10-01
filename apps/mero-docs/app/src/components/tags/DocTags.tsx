import * as React from 'react';

import { useWorkspaceIndexValue } from '@/context/WorkspaceIndexContext';
import { useTags } from '@/hooks/useTags';
import { plural } from '@/lib/plural';
import {
  docTagChips,
  findTagByName,
  firstUnusedColor,
  normalizeTagName,
  tagCounts,
  tagSuggestions,
  TAG_COLORS,
} from '@/lib/tags';
import { AddTagPopover } from './AddTagPopover';
import { DocTagRow } from './DocTagRow';

const ALREADY_ON_DOC = 'Already on this document';

interface Props {
  tagKeys: string[];
  canEdit: boolean;
  onAdd: (key: string) => void;
  onRemove: (key: string) => void;
}

// A document's tag row, named from the workspace tags; Add tag picks an existing tag before offering a new one.
export function DocTags({ tagKeys, canEdit, onAdd, onRemove }: Props) {
  const { tags, byKey, createTag } = useTags();
  const { rows } = useWorkspaceIndexValue();
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [color, setColor] = React.useState<string>(TAG_COLORS[0]);

  const chips = docTagChips(tagKeys, byKey);
  const name = normalizeTagName(query);
  const named = name ? findTagByName(tags, name) : undefined;
  const counts = open ? tagCounts(rows) : new Map<string, number>();
  const suggestions = open
    ? tagSuggestions(tags, name, tagKeys, counts).map((t) => ({
        key: t.key,
        name: t.name,
        color: t.color,
        countLabel: plural(counts.get(t.key) ?? 0, 'doc'),
      }))
    : [];

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) return;
    setQuery('');
    setColor(firstUnusedColor(tags));
  };
  const pick = (key: string) => {
    setOpen(false);
    onAdd(key);
  };
  const create = () => {
    setOpen(false);
    // A failed create has already been reported; there is nothing to add.
    createTag(name, color).then(onAdd, () => {});
  };

  return (
    <DocTagRow
      tags={chips}
      canEdit={canEdit}
      onRemove={onRemove}
      addTrigger={
        <AddTagPopover
          open={open}
          onOpenChange={onOpenChange}
          query={query}
          onQueryChange={setQuery}
          suggestions={suggestions}
          canCreate={!!name && !named}
          createLabel={name}
          note={
            named && tagKeys.includes(named.key) ? ALREADY_ON_DOC : undefined
          }
          color={color}
          onColorChange={setColor}
          onPick={pick}
          onCreate={create}
        />
      }
    />
  );
}
