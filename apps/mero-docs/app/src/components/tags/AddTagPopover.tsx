import * as React from 'react';
import { Plus } from 'lucide-react';

import { cn } from '@/lib/utils';
import { TAG_COLORS, TAG_COLOR_NAMES, TAG_NEUTRAL } from '@/lib/tags';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';

const rowClass =
  'flex h-8 cursor-pointer items-center gap-2 rounded-md px-2 text-[13px] text-secondary-foreground aria-selected:bg-accent aria-selected:text-foreground'; // a suggestion or the create row

export interface TagSuggestion {
  key: string;
  name: string;
  color?: string;
  countLabel: string;
}

interface AddTagPopoverProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  query: string;
  onQueryChange: (query: string) => void;
  suggestions: TagSuggestion[];
  canCreate: boolean;
  createLabel: string;
  color: string;
  onColorChange: (color: string) => void;
  onPick: (key: string) => void;
  onCreate: () => void;
}

export const AddTagButton = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement>
>(({ className, ...props }, ref) => (
  <button
    ref={ref}
    type="button"
    className={cn(
      'inline-flex h-6 items-center gap-[5px] whitespace-nowrap rounded-full border border-dashed border-muted-foreground/40 px-2 text-xs text-muted-foreground outline-none transition-colors',
      'hover:bg-accent hover:text-foreground focus-visible:border-solid focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40',
      'data-[state=open]:border-solid data-[state=open]:border-ring data-[state=open]:text-foreground data-[state=open]:ring-2 data-[state=open]:ring-ring/40',
      className,
    )}
    {...props}
  >
    <Plus aria-hidden className="h-3 w-3" />
    Add tag
  </button>
));
AddTagButton.displayName = 'AddTagButton';

interface TagColorSwatchesProps {
  value: string;
  onChange: (color: string) => void;
  labelledBy: string;
  className?: string;
}

// Radios, so Tab reaches the group, arrows move between colours and each one is named.
export function TagColorSwatches({
  value,
  onChange,
  labelledBy,
  className,
}: TagColorSwatchesProps) {
  return (
    <div
      role="radiogroup"
      aria-labelledby={labelledBy}
      className={cn('flex items-center gap-1.5', className)}
    >
      {TAG_COLORS.map((swatch, i) => (
        <label key={swatch} className="cursor-pointer">
          <input
            type="radio"
            name={labelledBy}
            value={swatch}
            aria-label={TAG_COLOR_NAMES[i]}
            checked={value === swatch}
            onChange={() => onChange(swatch)}
            className="peer sr-only"
          />
          <span
            aria-hidden
            className="block h-[18px] w-[18px] rounded-full shadow-[inset_0_0_0_1px_rgba(0,0,0,0.1)] peer-checked:ring-2 peer-checked:ring-ring peer-checked:ring-offset-2 peer-checked:ring-offset-popover peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-ring/50"
            style={{ backgroundColor: swatch }}
          />
        </label>
      ))}
    </div>
  );
}

// Suggestions first so an existing tag wins over a near-duplicate; the create row comes last.
export function AddTagPopover({
  open,
  onOpenChange,
  query,
  onQueryChange,
  suggestions,
  canCreate,
  createLabel,
  color,
  onColorChange,
  onPick,
  onCreate,
}: AddTagPopoverProps) {
  const listId = React.useId();
  const colourLabelId = React.useId();
  const [index, setIndex] = React.useState(0);
  const rowCount = suggestions.length + (canCreate ? 1 : 0);
  const active = Math.min(index, rowCount - 1);

  const choose = (row: number) => {
    const suggestion = suggestions[row];
    if (suggestion) onPick(suggestion.key);
    else if (canCreate) onCreate();
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setIndex(Math.max(0, Math.min(rowCount - 1, active + step)));
    } else if (event.key === 'Enter' && rowCount > 0) {
      event.preventDefault();
      choose(active);
    }
  };

  const option = (row: number, content: React.ReactNode) => (
    <div
      key={row}
      id={`${listId}-${row}`}
      role="option"
      aria-selected={row === active}
      className={rowClass}
      onMouseMove={() => setIndex(row)}
      // Keeps focus in the input, so the keyboard carries on where the mouse left off.
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => choose(row)}
    >
      {content}
    </div>
  );

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <AddTagButton />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[260px] max-w-[calc(100vw-16px)] overflow-hidden rounded-[10px] p-0"
      >
        <div className="px-2 pb-1.5 pt-2">
          <input
            role="combobox"
            aria-label="Tag name"
            aria-expanded={rowCount > 0}
            aria-controls={rowCount > 0 ? listId : undefined}
            aria-autocomplete="list"
            aria-activedescendant={
              rowCount > 0 ? `${listId}-${active}` : undefined
            }
            placeholder="Find or create a tag"
            value={query}
            onChange={(event) => {
              onQueryChange(event.target.value);
              setIndex(0);
            }}
            onKeyDown={onKeyDown}
            className="h-8 w-full rounded-md border border-input bg-popover px-2.5 text-[13px] text-foreground outline-none placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/40"
          />
        </div>
        {rowCount > 0 && (
          <div
            id={listId}
            role="listbox"
            aria-label="Tags"
            className="px-1 pb-1"
          >
            {suggestions.map((tag, row) =>
              option(
                row,
                <>
                  <span
                    aria-hidden
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: tag.color ?? TAG_NEUTRAL }}
                  />
                  <span className="min-w-0 truncate">{tag.name}</span>
                  <span className="ml-auto shrink-0 text-[11.5px] text-muted-foreground">
                    {tag.countLabel}
                  </span>
                </>,
              ),
            )}
            {canCreate && suggestions.length > 0 && (
              <div role="presentation" className="my-1 h-px bg-border" />
            )}
            {canCreate &&
              option(
                suggestions.length,
                <>
                  <Plus aria-hidden className="h-3.5 w-3.5 shrink-0" />
                  <span className="min-w-0 truncate">
                    Create tag “{createLabel}”
                  </span>
                </>,
              )}
          </div>
        )}
        <div
          id={colourLabelId}
          className="px-3 pb-1 text-xs text-muted-foreground"
        >
          Colour for a new tag
        </div>
        <TagColorSwatches
          value={color}
          onChange={onColorChange}
          labelledBy={colourLabelId}
          className="px-3 pb-2.5 pt-1"
        />
      </PopoverContent>
    </Popover>
  );
}
