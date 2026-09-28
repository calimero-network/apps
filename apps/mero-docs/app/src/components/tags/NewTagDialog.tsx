import * as React from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogTitle,
} from '@/components/ui/dialog';
import { TagColorSwatches } from './AddTagPopover';

interface Props {
  open: boolean;
  color: string; // the colour it starts on
  error?: string;
  onSubmit: (name: string, color: string) => void;
  onOpenChange: (open: boolean) => void;
}

// A tag with no document yet, from the sidebar's Tags "+".
export function NewTagDialog({ open, onOpenChange, ...form }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined} className="max-w-sm">
        <NewTagForm {...form} onCancel={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

// Mounted per open, so every new tag starts from an empty name.
function NewTagForm({
  color: initialColor,
  error,
  onSubmit,
  onCancel,
}: Omit<Props, 'open' | 'onOpenChange'> & { onCancel: () => void }) {
  const [name, setName] = React.useState('');
  const [color, setColor] = React.useState(initialColor);
  const inputId = React.useId();
  const errorId = React.useId();
  const colourLabelId = React.useId();
  const next = name.trim();

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (next) onSubmit(next, color);
      }}
    >
      <DialogTitle className="mb-4 text-[15px] tracking-[-0.01em]">
        New tag
      </DialogTitle>
      <label
        htmlFor={inputId}
        className="mb-1.5 block text-xs font-medium text-muted-foreground"
      >
        Name
      </label>
      <Input
        id={inputId}
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className={
          error
            ? 'border-destructive focus-visible:border-destructive focus-visible:ring-destructive/30'
            : undefined
        }
      />
      {error && (
        <p id={errorId} className="mt-1.5 text-xs text-destructive">
          {error}
        </p>
      )}
      <div
        id={colourLabelId}
        className="mb-2 mt-4 text-xs font-medium text-muted-foreground"
      >
        Colour
      </div>
      <TagColorSwatches
        value={color}
        onChange={setColor}
        labelledBy={colourLabelId}
      />
      <DialogFooter>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={!next}>
          Create
        </Button>
      </DialogFooter>
    </form>
  );
}
