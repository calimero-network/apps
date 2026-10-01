import * as React from 'react';
import { Ellipsis, Palette, Pencil, Trash2 } from 'lucide-react';

import { cn } from '@/lib/utils';
import { TAG_COLORS, TAG_COLOR_NAMES } from '@/lib/tags';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { HomeHeader, headerActionClass } from '@/components/home/HomeHeader';
import { TagDot } from './TagChip';

interface Props {
  name: string;
  color?: string;
  subtitle: string;
  canManage: boolean;
  busy?: boolean; // a change is in flight, so no other can start
  actions?: React.ReactNode; // shown before the tag's own Rename and More
  onRename: () => void;
  onRecolor: (color: string) => void;
  onDelete: () => void;
}

export function TagPageHeader({
  name,
  color,
  subtitle,
  canManage,
  busy = false,
  actions: extraActions,
  onRename,
  onRecolor,
  onDelete,
}: Props) {
  const manageActions = canManage && (
    <>
      <Button
        variant="outline"
        disabled={busy}
        onClick={onRename}
        className={cn(headerActionClass, 'bg-card [&_svg]:size-[13px]')}
      >
        <Pencil aria-hidden />
        Rename
      </Button>
      <DropdownMenu>
        {/* The trigger checks disabled itself before opening; a disabled child alone does not stop it. */}
        <DropdownMenuTrigger asChild disabled={busy}>
          <Button
            variant="ghost"
            size="icon"
            aria-label="More"
            className="h-[30px] w-[30px] rounded-md [&_svg]:size-[15px]"
          >
            <Ellipsis aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-44">
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className="gap-2">
              <Palette
                className="h-3.5 w-3.5 text-muted-foreground"
                aria-hidden
              />
              Colour
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="min-w-36">
              <DropdownMenuRadioGroup value={color} onValueChange={onRecolor}>
                {TAG_COLORS.map((c, i) => (
                  <DropdownMenuRadioItem key={c} value={c} className="gap-2">
                    <span
                      className="h-3 w-3 shrink-0 rounded-full"
                      style={{ backgroundColor: c }}
                      aria-hidden
                    />
                    {TAG_COLOR_NAMES[i]}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={onDelete}
            className="gap-2 text-destructive focus:bg-destructive/10 focus:text-destructive"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden />
            Delete tag
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );

  return (
    <HomeHeader
      title={
        <>
          <TagDot color={color} className="h-3 w-3" />
          <span className="truncate">{name}</span>
        </>
      }
      subtitle={subtitle}
      actions={
        extraActions || manageActions ? (
          <>
            {extraActions}
            {manageActions}
          </>
        ) : undefined
      }
    />
  );
}
