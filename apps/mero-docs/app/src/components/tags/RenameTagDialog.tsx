import * as React from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogTitle,
} from '@/components/ui/dialog';

interface Props {
  open: boolean;
  title?: string;
  name: string;
  error?: string;
  onSubmit: (name: string) => void;
  onOpenChange: (open: boolean) => void;
}

export function RenameTagDialog({ open, onOpenChange, ...form }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined} className="max-w-sm">
        <RenameForm {...form} onCancel={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

// Mounted per open, so the field starts from the current name every time.
function RenameForm({
  title = 'Rename tag',
  name,
  error: givenError,
  onSubmit,
  onCancel,
}: Omit<Props, 'open' | 'onOpenChange'> & { onCancel: () => void }) {
  const [value, setValue] = React.useState(name);
  const inputId = React.useId();
  const errorId = React.useId();
  // An error is about the name that was saved, so editing it clears the error.
  const [edited, setEdited] = React.useState(false);
  const error = edited ? undefined : givenError;
  const next = value.trim();

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setEdited(false);
        if (next) onSubmit(next);
      }}
    >
      <DialogTitle className="mb-4 text-[15px] tracking-[-0.01em]">
        {title}
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
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setEdited(true);
        }}
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
      <DialogFooter>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={!next}>
          Save
        </Button>
      </DialogFooter>
    </form>
  );
}
