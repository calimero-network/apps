import * as React from 'react';
import { Check } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { TagDot } from '@/components/tags/TagChip';
import { moveFocus } from './moveFocus';

interface ChecklistItem {
  id: string;
  label: string;
  dotColor?: string;
  count: number;
  checked: boolean;
}

interface Props {
  placeholder: string;
  items: ChecklistItem[];
  onToggle: (id: string) => void;
  onClear: () => void;
  footerHint: string;
}

export function FilterChecklist({
  placeholder,
  items,
  onToggle,
  onClear,
  footerHint,
}: Props) {
  const [query, setQuery] = React.useState('');
  const needle = query.trim().toLowerCase();
  const shown = needle
    ? items.filter((i) => i.label.toLowerCase().includes(needle))
    : items;

  return (
    <div
      className="w-[250px]"
      onKeyDown={(e) => moveFocus(e, 'input, [role="checkbox"]')}
    >
      <div className="px-2 pb-1.5 pt-2">
        <Input
          autoFocus
          aria-label={placeholder}
          placeholder={placeholder}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="max-h-64 overflow-y-auto px-1 pb-1">
        {shown.length === 0 ? (
          <p className="px-2 py-3 text-center text-[13px] text-muted-foreground">
            No matches
          </p>
        ) : (
          shown.map((item) => (
            <button
              key={item.id}
              type="button"
              role="checkbox"
              aria-checked={item.checked}
              onClick={() => onToggle(item.id)}
              className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] text-secondary-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:bg-accent focus-visible:text-foreground"
            >
              <span
                aria-hidden
                className={cn(
                  'flex h-[15px] w-[15px] shrink-0 items-center justify-center rounded-[4px] border-[1.5px]',
                  item.checked
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-muted-foreground/45',
                )}
              >
                {item.checked && (
                  <Check className="h-2.5 w-2.5" strokeWidth={3} />
                )}
              </span>
              {item.dotColor !== undefined && (
                <TagDot color={item.dotColor} className="h-2 w-2" />
              )}
              <span className="truncate">{item.label}</span>
              <span className="ml-auto pl-2 text-[11.5px] tabular-nums text-muted-foreground">
                {item.count}
              </span>
            </button>
          ))
        )}
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-border/60 bg-background py-2 pl-3 pr-2">
        <span className="text-xs text-muted-foreground">{footerHint}</span>
        <Button
          variant="ghost"
          onClick={onClear}
          className="h-7 rounded-md px-2.5 text-xs"
        >
          Clear
        </Button>
      </div>
    </div>
  );
}
