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
        'group relative inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border bg-secondary text-secondary-foreground',
        size === 'lg' ? 'h-6 px-2 text-xs' : 'h-5 px-1.5 text-[11.5px]',
        className
      )}
    >
      <TagDot color={color} size={size} />
      {name}
      {/* Overlays the trailing edge on hover or focus, so a removable chip is no wider than a plain one. */}
      {onRemove && (
        <button
          type="button"
          aria-label={`Remove tag ${name}`}
          onClick={onRemove}
          className="absolute inset-y-0 right-0 flex items-center rounded-r-full bg-secondary pl-0.5 pr-1 opacity-0 shadow-[-6px_0_6px_hsl(var(--secondary))] outline-none transition-opacity focus-visible:opacity-100 focus-visible:ring-1 focus-visible:ring-ring group-hover:opacity-100"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </span>
  );
}
