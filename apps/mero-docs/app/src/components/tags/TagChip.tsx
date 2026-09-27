import * as React from 'react';
import { X } from 'lucide-react';

import { cn } from '@/lib/utils';
import { TAG_NEUTRAL } from '@/lib/tags';

interface TagDotProps {
  color?: string;
  size?: 'sm' | 'lg';
  className?: string;
}

export function TagDot({ color, size = 'sm', className }: TagDotProps) {
  return (
    <span
      data-testid="tag-dot"
      className={cn('inline-block flex-shrink-0 rounded-full', size === 'lg' ? 'h-[7px] w-[7px]' : 'h-1.5 w-1.5', className)}
      style={{ backgroundColor: color ?? TAG_NEUTRAL }}
    />
  );
}

interface TagChipProps {
  name: string;
  color?: string;
  size?: 'sm' | 'lg';
  onRemove?: () => void;
  className?: string;
}

export function TagChip({ name, color, size = 'sm', onRemove, className }: TagChipProps) {
  return (
    <span
      className={cn(
        'group inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border bg-secondary text-secondary-foreground',
        size === 'lg' ? 'h-6 px-2 text-xs' : 'h-5 px-1.5 text-[11.5px]',
        className
      )}
    >
      {/* The X takes the dot's place on hover or focus; it is absolutely placed so nothing shifts and the name stays whole. */}
      <span data-testid="tag-dot-slot" className="relative inline-flex shrink-0 items-center justify-center">
        <TagDot
          color={color}
          size={size}
          className={onRemove && 'transition-opacity group-focus-within:opacity-0 group-hover:opacity-0'}
        />
        {onRemove && (
          <button
            type="button"
            aria-label={`Remove tag ${name}`}
            onClick={onRemove}
            className="absolute left-1/2 top-1/2 flex h-4 w-4 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full opacity-0 outline-none transition-opacity focus-visible:ring-1 focus-visible:ring-ring group-focus-within:opacity-100 group-hover:opacity-100"
          >
            <X className="h-2.5 w-2.5" strokeWidth={2.5} />
          </button>
        )}
      </span>
      {name}
    </span>
  );
}
