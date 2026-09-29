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
  title: string;
  submitLabel?: string;
  maxLength?: number; // caps the field and shows a keep-it-short hint
  validate?: (name: string) => string | undefined; // a message blocks the save
  name?: string; // the name the field starts from
  color?: string; // shows the colour swatches, starting on this one
  error?: string;
  onSubmit: (name: string, color?: string) => void;
  onOpenChange: (open: boolean) => void;
}

export function NameDialog({ open, onOpenChange, ...form }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined} className="max-w-sm">
        <NameForm {...form} onCancel={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

// Mounted per open, so the field starts from the given name every time.
function NameForm({
  title,
  submitLabel = 'Save',
  maxLength,
  validate,
  name = '',
  color: initialColor,
  error: givenError,
  onSubmit,
  onCancel,
}: Omit<Props, 'open' | 'onOpenChange'> & { onCancel: () => void }) {
  const [value, setValue] = React.useState(name);
  const [color, setColor] = React.useState(initialColor);
  const inputId = React.useId();
  const errorId = React.useId();
  const helpId = React.useId();
  const colourLabelId = React.useId();
  // An error is about the name that was saved, so editing it clears the error.
  const [edited, setEdited] = React.useState(false);
  const next = value.trim();
  const invalid = validate?.(next);
  const error = invalid ?? (edited ? undefined : givenError);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setEdited(false);
        if (next && !invalid) onSubmit(next, color);
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
        maxLength={maxLength}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : maxLength ? helpId : undefined}
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
      {maxLength && !error && (
        <p id={helpId} className="mt-1.5 text-xs text-muted-foreground">
          Keep it short.
        </p>
      )}
      {initialColor && (
        <>
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
        </>
      )}
      <DialogFooter>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={!next || !!invalid}>
          {submitLabel}
        </Button>
      </DialogFooter>
    </form>
  );
}
