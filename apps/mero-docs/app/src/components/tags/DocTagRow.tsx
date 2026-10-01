import * as React from 'react';
import { Tag } from 'lucide-react';

import type { TagView } from '@/lib/tags';
import { TagChip } from './TagChip';

interface DocTagRowProps {
  tags: TagView[];
  canEdit: boolean;
  onRemove: (key: string) => void;
  addTrigger: React.ReactNode;
}

// The tags above a document's first line; editors can remove and add.
export function DocTagRow({
  tags,
  canEdit,
  onRemove,
  addTrigger,
}: DocTagRowProps) {
  const labelId = React.useId();
  if (!canEdit && tags.length === 0) return null;
  return (
    <div
      role="group"
      aria-labelledby={labelId}
      className="mb-[18px] flex flex-wrap items-center gap-1.5"
    >
      <span
        id={labelId}
        className="mr-1 flex items-center gap-[5px] text-xs text-muted-foreground"
      >
        <Tag aria-hidden className="h-[13px] w-[13px]" />
        Tags
      </span>
      {tags.map((tag) => (
        <TagChip
          key={tag.key}
          name={tag.name}
          color={tag.color}
          size="lg"
          onRemove={canEdit ? () => onRemove(tag.key) : undefined}
        />
      ))}
      {canEdit && addTrigger}
    </div>
  );
}
