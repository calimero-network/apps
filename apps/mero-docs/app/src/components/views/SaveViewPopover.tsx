import * as React from 'react';
import { PopoverClose } from '@radix-ui/react-popover';
import {
  ArrowDownWideNarrow,
  User,
  Users,
  type LucideIcon,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import {
  VIEW_NAME_MAX,
  VIEW_NAME_TOO_LONG,
  viewNameFits,
} from '@/lib/viewName';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { TagChip } from '@/components/tags/TagChip';
import { FILTER_ICONS } from '@/components/home/FilterBar';
import { moveFocus } from '@/components/home/moveFocus';
import type { FilterIcon } from '@/components/home/types';

type Scope = 'me' | 'everyone';
type FilterSummary = {
  icon: FilterIcon | 'sort';
  label: string;
  color?: string;
};

const SUMMARY_ICONS: Record<FilterSummary['icon'], LucideIcon> = {
  ...FILTER_ICONS,
  sort: ArrowDownWideNarrow,
};

interface Props {
  trigger?: React.ReactNode;
  anchorRef?: React.RefObject<HTMLElement | null>; // opens beside a control that is not its trigger
  defaultName: string;
  filters: FilterSummary[];
  workspaceName: string;
  canShare: boolean;
  saving: boolean;
  onSave: (view: { name: string; scope: Scope }) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function SaveViewPopover({
  trigger,
  anchorRef,
  open,
  onOpenChange,
  ...form
}: Props) {
  // Without a trigger, Radix has nothing to return focus to on close.
  const returnFocus = anchorRef
    ? (e: Event) => {
        e.preventDefault();
        anchorRef.current?.focus();
      }
    : undefined;
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      {anchorRef ? (
        <PopoverAnchor virtualRef={anchorRef} />
      ) : (
        <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      )}
      <PopoverContent
        align="end"
        className="w-[320px] overflow-hidden rounded-[10px] p-0"
        onCloseAutoFocus={returnFocus}
      >
        <SaveViewForm {...form} />
      </PopoverContent>
    </Popover>
  );
}

// Mounted per open, so the name and scope start fresh every time.
function SaveViewForm({
  defaultName,
  filters,
  workspaceName,
  canShare,
  saving,
  onSave,
}: Omit<Props, 'trigger' | 'anchorRef' | 'open' | 'onOpenChange'>) {
  const [name, setName] = React.useState(defaultName);
  const [scope, setScope] = React.useState<Scope>('me');
  const nameId = React.useId();
  const tooLongId = React.useId();
  const tooLong = !viewNameFits(name);
  const canSave = name.trim() !== '' && !tooLong && !saving;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (canSave) onSave({ name: name.trim(), scope });
      }}
    >
      <div className="px-3 pb-2 pt-2.5 text-xs font-semibold text-foreground">
        Save this view
      </div>
      <div className="flex flex-col gap-3 px-3 pb-3">
        <div>
          <label
            htmlFor={nameId}
            className="mb-1.5 block text-xs font-medium text-muted-foreground"
          >
            Name
          </label>
          <Input
            id={nameId}
            autoFocus
            maxLength={VIEW_NAME_MAX}
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-invalid={tooLong || undefined}
            aria-describedby={tooLong ? tooLongId : undefined}
          />
          {tooLong && (
            <p id={tooLongId} className="mt-1.5 text-xs text-destructive">
              {VIEW_NAME_TOO_LONG}
            </p>
          )}
        </div>
        <div>
          <div className="mb-1.5 text-xs font-medium text-muted-foreground">
            Filters
          </div>
          <div className="flex flex-wrap gap-1.5">
            {filters.map((f, i) => {
              if (f.icon === 'tag')
                return <TagChip key={i} name={f.label} color={f.color} />;
              const Icon = SUMMARY_ICONS[f.icon];
              return (
                <span
                  key={i}
                  className="inline-flex h-5 items-center gap-1 whitespace-nowrap rounded-full border bg-secondary px-1.5 text-[11.5px] text-secondary-foreground"
                >
                  <Icon
                    className="h-[11px] w-[11px] text-muted-foreground"
                    aria-hidden
                  />
                  {f.label}
                </span>
              );
            })}
          </div>
        </div>
        <div
          role="radiogroup"
          aria-label="Who sees this view"
          className="grid gap-2"
          onKeyDown={(e) => moveFocus(e, '[role="radio"]')}
        >
          <ScopeCard
            icon={User}
            title="Only me"
            body="Pinned in your sidebar on this device"
            checked={scope === 'me'}
            onSelect={() => setScope('me')}
          />
          <ScopeCard
            icon={Users}
            title={`Everyone in ${workspaceName}`}
            body="Shows in every member's sidebar"
            checked={scope === 'everyone'}
            disabled={!canShare}
            onSelect={() => setScope('everyone')}
          />
        </div>
      </div>
      <div className="flex justify-end gap-2 border-t border-border/60 bg-background px-3 py-2.5">
        <PopoverClose asChild>
          <Button
            type="button"
            variant="ghost"
            className="h-7 rounded-md px-2.5 text-xs"
          >
            Cancel
          </Button>
        </PopoverClose>
        <Button
          type="submit"
          disabled={!canSave}
          className="h-7 rounded-md px-2.5 text-xs"
        >
          {saving ? 'Saving…' : 'Save view'}
        </Button>
      </div>
    </form>
  );
}

interface ScopeCardProps {
  icon: LucideIcon;
  title: string;
  body: string;
  checked: boolean;
  disabled?: boolean;
  onSelect: () => void;
}

function ScopeCard({
  icon: Icon,
  title,
  body,
  checked,
  disabled,
  onSelect,
}: ScopeCardProps) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        'flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
        checked
          ? 'border-primary-ink bg-primary/20 shadow-[inset_0_0_0_1px_hsl(var(--primary-ink))] dark:bg-primary/10'
          : 'border-border hover:bg-accent',
      )}
    >
      <Icon
        className={cn(
          'mt-0.5 h-[15px] w-[15px] shrink-0',
          checked ? 'text-primary-ink' : 'text-muted-foreground/80',
        )}
        aria-hidden
      />
      <span className="min-w-0">
        <span className="block truncate text-[13px] font-medium text-foreground">
          {title}
        </span>
        <span className="block text-xs text-muted-foreground">{body}</span>
      </span>
    </button>
  );
}
