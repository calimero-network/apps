// Resizable left panel. Width is controlled by the parent (persisted
// via useLocalStorage in WorkspaceLayout); this component owns only
// the drag interaction. Collapse is handled by the parent simply not
// rendering this component, so there is no collapsed state here.
// Below md the parent renders SidebarDrawer instead.

import React, { useCallback, useEffect, useRef } from 'react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog';

interface Props {
  width: number;
  minWidth?: number;
  maxWidth?: number;
  onWidthChange: (w: number) => void;
  children: React.ReactNode;
}

export function WorkspaceSidebar({
  width,
  minWidth = 200,
  maxWidth = 480,
  onWidthChange,
  children,
}: Props) {
  const draggingRef = useRef(false);

  const clamp = useCallback(
    (w: number) => Math.min(maxWidth, Math.max(minWidth, w)),
    [minWidth, maxWidth],
  );

  // Window-level move/up listeners so the drag keeps tracking even if
  // the pointer leaves the 4px handle. Re-bound whenever clamp /
  // onWidthChange identity changes; cleaned up on unmount.
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!draggingRef.current) return;
      onWidthChange(clamp(e.clientX));
    };
    const onUp = () => {
      draggingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [clamp, onWidthChange]);

  const onHandleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      onWidthChange(clamp(width - 16));
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      onWidthChange(clamp(width + 16));
    }
  };

  return (
    <aside
      style={{ width: `${width}px` }}
      className="relative shrink-0 border-r border-border bg-muted/20"
    >
      {children}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        tabIndex={0}
        onKeyDown={onHandleKeyDown}
        onPointerDown={(e: React.PointerEvent) => {
          if (e.currentTarget.setPointerCapture)
            e.currentTarget.setPointerCapture(e.pointerId);
          draggingRef.current = true;
          document.body.style.cursor = 'col-resize';
          document.body.style.userSelect = 'none';
        }}
        className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-ring/40 focus-visible:bg-ring focus-visible:outline-none"
      />
    </aside>
  );
}

// Modal overlay from the left edge; the dialog supplies the focus trap,
// Escape / backdrop close and focus return to the toggle.
export function SidebarDrawer({
  open,
  onOpenChange,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby={undefined}
        className="inset-y-0 left-0 flex w-[min(20rem,85vw)] max-w-none max-h-full translate-x-0 translate-y-0 flex-col overflow-hidden rounded-none border-y-0 border-l-0 p-0 data-[state=open]:animate-in data-[state=open]:slide-in-from-left data-[state=closed]:animate-out data-[state=closed]:slide-out-to-left"
      >
        <DialogTitle className="sr-only">Folders</DialogTitle>
        {children}
      </DialogContent>
    </Dialog>
  );
}
