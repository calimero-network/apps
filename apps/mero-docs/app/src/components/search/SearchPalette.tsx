import * as React from 'react';
import {
  CornerDownLeft,
  FileText,
  Folder,
  Hash,
  Search,
  ShieldCheck,
  TextAlignStart,
  WifiOff,
  X,
} from 'lucide-react';

import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Highlight, type HighlightRange } from '@/components/common/Highlight';
import { Kbd } from '@/components/common/Kbd';
import { KEY_LABELS } from '@/lib/platform';
import { TAG_NEUTRAL } from '@/lib/tags';
import { cn } from '@/lib/utils';

import type { PaletteGroupView, PaletteItemView } from './types';

const PLACEHOLDER = 'Search docs, folders and #tags'; // same wording as the top-bar field
const KIND_ICON = { doc: FileText, recent: FileText, text: TextAlignStart, folder: Folder, tip: Hash }; // tag rows show a dot instead
const FAINT = 'text-muted-foreground/80'; // the mockup's faint ink for labels, context and hints

export type OpenOptions = { newTab: boolean };

interface SearchPalettePanelProps {
  query: string;
  onQueryChange: (query: string) => void;
  scopeLabel: string;
  groups: PaletteGroupView[];
  warning?: React.ReactNode;
  emptyText: string; // '' while nothing can be claimed yet, e.g. a search still reading
  onOpen: (item: PaletteItemView, options: OpenOptions) => void;
  onClose: () => void;
  inputRef?: React.Ref<HTMLInputElement>;
}

export interface SearchPaletteProps extends Omit<SearchPalettePanelProps, 'onClose'> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// Below md the dialog is a full-screen sheet; from md it floats top-centre like the mockup.
export function SearchPalette({ open, onOpenChange, ...panel }: SearchPaletteProps) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby={undefined}
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          focusAtEnd(inputRef.current);
        }}
        className="left-0 top-0 flex h-dvh max-h-none w-full max-w-none translate-x-0 translate-y-0 flex-col overflow-hidden rounded-none border-0 p-0 md:left-1/2 md:top-8 md:h-auto md:max-h-[calc(100dvh-4rem)] md:w-[calc(100vw-2rem)] md:max-w-[660px] md:-translate-x-1/2 md:rounded-xl md:border"
      >
        <DialogTitle className="sr-only">Search</DialogTitle>
        <SearchPalettePanel {...panel} inputRef={inputRef} onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

// The pulsing progress line for a group header's aside, e.g. "3 of 5 folders searched".
export function SearchProgress({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-primary-ink">
      <span
        aria-hidden
        className="h-1.5 w-1.5 rounded-full bg-primary shadow-[0_0_0_3px_hsl(var(--primary)/0.2)] motion-safe:animate-pulse"
      />
      {label}
    </span>
  );
}

// Radix would select the whole query on open; a reopened palette should keep typing after it instead.
function focusAtEnd(input: HTMLInputElement | null) {
  if (!input) return;
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
}

function toRanges(ranges: [number, number][] | undefined): HighlightRange[] {
  return (ranges ?? []).map(([start, end]) => ({ start, end }));
}

// Moves only the results box, so an off-screen palette in the dev gallery never scrolls the page.
function keepInView(box: HTMLElement | null, el: HTMLElement | null, first: boolean) {
  if (!box || !el) return;
  if (first) box.scrollTop = 0;
  else if (el.offsetTop < box.scrollTop) box.scrollTop = el.offsetTop;
  else if (el.offsetTop + el.offsetHeight > box.scrollTop + box.clientHeight)
    box.scrollTop = el.offsetTop + el.offsetHeight - box.clientHeight;
}

export function SearchPalettePanel({
  query,
  onQueryChange,
  scopeLabel,
  groups,
  warning,
  emptyText,
  onOpen,
  onClose,
  inputRef,
}: SearchPalettePanelProps) {
  const baseId = React.useId();
  const listId = `${baseId}-list`;
  const resultsRef = React.useRef<HTMLDivElement>(null);
  const openable = React.useMemo(() => groups.flatMap((g) => g.items).filter((i) => i.kind !== 'tip'), [groups]);
  // The active row is remembered by id for the query it was picked under, so results that
  // refresh under the same query keep it; a new query, or a row that left, starts at the top.
  const [cursor, setCursor] = React.useState<{ query: string; id?: string }>({ query });
  const found = cursor.query === query ? openable.findIndex((i) => i.id === cursor.id) : -1;
  const index = Math.max(found, 0);
  const optionId = (i: number) => `${baseId}-opt-${i}`;
  const activeId = openable.length > 0 ? optionId(index) : undefined;

  React.useEffect(() => {
    if (activeId) keepInView(resultsRef.current, document.getElementById(activeId), index === 0);
  }, [activeId, index]);

  const move = (next: number) => setCursor({ query, id: openable[next]?.id });

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const n = openable.length;
    if (e.nativeEvent.isComposing || n === 0) return;
    if (e.key === 'ArrowDown') move((index + 1) % n);
    else if (e.key === 'ArrowUp') move((index - 1 + n) % n);
    else if (e.key === 'Home') move(0);
    else if (e.key === 'End') move(n - 1);
    else if (e.key === 'Enter') onOpen(openable[index], { newTab: e.metaKey || e.ctrlKey });
    else return;
    e.preventDefault();
  };

  const visibleGroups = groups.filter((g) => g.items.length > 0 || g.aside);
  const showEmpty = !!emptyText && query.trim() !== '' && openable.length === 0 && groups.every((g) => g.items.length === 0);
  let flat = 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-[54px] shrink-0 items-center gap-2.5 border-b border-border/60 px-4">
        <Search className={cn('h-[18px] w-[18px] shrink-0', FAINT)} aria-hidden />
        <input
          ref={inputRef}
          type="text"
          aria-label="Search"
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeId}
          placeholder={PLACEHOLDER}
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={onKeyDown}
          className="min-w-0 flex-1 bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground/80 md:text-[15px]"
        />
        <span className={cn('hidden shrink-0 items-center gap-1.5 text-[11.5px] md:flex', FAINT)}>
          <span className="max-w-[160px] truncate">{scopeLabel}</span>
          <Kbd>esc</Kbd>
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close search"
          className="-mr-2 flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:hidden"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div
        ref={resultsRef}
        className="relative min-h-0 flex-1 overflow-y-auto p-1.5 md:max-h-[520px] [&_mark]:bg-primary/55 [&_mark]:font-semibold [&_mark]:text-inherit dark:[&_mark]:bg-primary/20"
      >
        <div role="listbox" id={listId} aria-label="Search results">
          {visibleGroups.map((group) => {
            const labelId = `${baseId}-group-${group.id}`;
            return (
              <div key={group.id} role="group" aria-labelledby={labelId}>
                <div
                  className={cn(
                    'flex items-center justify-between gap-3 px-2.5 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[0.06em]',
                    FAINT
                  )}
                >
                  <span id={labelId}>{group.label}</span>
                  {group.aside && (
                    <span className="flex min-w-0 items-center gap-1.5 truncate font-normal normal-case tracking-normal">
                      {group.aside}
                    </span>
                  )}
                </div>
                {group.items.map((item) => {
                  if (item.kind === 'tip') return <PaletteRow key={item.id} item={item} active={false} />;
                  const i = flat++;
                  return (
                    <PaletteRow
                      key={item.id}
                      id={optionId(i)}
                      item={item}
                      active={i === index}
                      onHover={() => move(i)}
                      onPick={(newTab) => onOpen(item, { newTab })}
                    />
                  );
                })}
              </div>
            );
          })}
        </div>
        {showEmpty && <p className="px-4 py-10 text-center text-[13px] text-muted-foreground">{emptyText}</p>}
        {warning && (
          <div className="mx-1 mb-0.5 mt-1.5 flex items-center gap-2 rounded-[7px] border border-warning/35 bg-warning/10 px-2.5 py-2 text-xs text-warning-ink">
            <WifiOff className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <span className="min-w-0">{warning}</span>
          </div>
        )}
      </div>

      <div
        className={cn(
          'flex h-9 shrink-0 items-center justify-center border-t border-border/60 bg-background px-3.5 text-[11.5px] md:justify-between',
          FAINT
        )}
      >
        <div className="hidden items-center gap-3.5 md:flex">
          <KeyHint keys={['↑', '↓']} label="move" />
          <KeyHint keys={['↵']} label="open" />
          <KeyHint keys={[KEY_LABELS.newTab]} label="open in new tab" />
          <KeyHint keys={['#']} label="tags only" />
        </div>
        <span className="flex items-center gap-1.5">
          <ShieldCheck className="h-[13px] w-[13px] shrink-0" aria-hidden />
          Searched on this device only
        </span>
      </div>
    </div>
  );
}

function KeyHint({ keys, label }: { keys: string[]; label: string }) {
  return (
    <span className="flex items-center gap-[5px]">
      {keys.map((k) => (
        <Kbd key={k} className="h-[18px] px-1 text-[10.5px]">
          {k}
        </Kbd>
      ))}
      {label}
    </span>
  );
}

interface PaletteRowProps {
  item: PaletteItemView;
  active: boolean;
  id?: string;
  onHover?: () => void;
  onPick?: (newTab: boolean) => void;
}

function PaletteRow({ item, active, id, onHover, onPick }: PaletteRowProps) {
  const Icon = item.icon ?? (item.kind === 'tag' ? null : KIND_ICON[item.kind]);
  return (
    <div
      id={id}
      role="option"
      aria-selected={active}
      aria-disabled={onPick ? undefined : true}
      onMouseMove={onHover && !active ? onHover : undefined}
      // Keeps focus in the input, so the keyboard still drives the list after a click.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onPick ? (e) => onPick(e.metaKey || e.ctrlKey) : undefined}
      className={cn(
        'flex min-h-11 items-center gap-2.5 rounded-[7px] px-2.5 py-1.5 text-secondary-foreground md:min-h-10',
        onPick && 'cursor-pointer',
        active && 'bg-selected text-selected-foreground'
      )}
    >
      {Icon ? (
        <Icon className={cn('h-4 w-4 shrink-0', active ? 'opacity-75' : FAINT)} aria-hidden />
      ) : (
        <span aria-hidden className="flex w-4 shrink-0 justify-center">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: item.tagColor ?? TAG_NEUTRAL }} />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className={cn('truncate text-[13px] font-medium', active ? 'text-selected-foreground' : 'text-foreground')}>
          <Highlight text={item.title} ranges={toRanges(item.titleRanges)} />
        </div>
        {item.context && (
          <div className={cn('mt-px flex min-w-0 items-center gap-1.5 overflow-hidden whitespace-nowrap text-[11.5px]', FAINT)}>
            {item.context}
          </div>
        )}
        {item.snippet && (
          <div className="mt-0.5 truncate text-xs text-muted-foreground">
            <Highlight text={item.snippet} ranges={toRanges(item.snippetRanges)} />
          </div>
        )}
      </div>
      {(item.right || active) && (
        <span className={cn('flex shrink-0 items-center gap-1.5 text-[11.5px]', FAINT)}>
          {item.right}
          {active && <CornerDownLeft className="h-3.5 w-3.5" aria-hidden />}
        </span>
      )}
    </div>
  );
}
