import * as React from 'react';
import { Check } from 'lucide-react';

import { moveFocus } from './moveFocus';

export type UpdatedWindow = '1d' | '7d' | '30d' | undefined;

const OPTIONS: { value: UpdatedWindow; label: string }[] = [
  { value: '1d', label: 'Today' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: undefined, label: 'Any time' },
];

interface Props {
  value: UpdatedWindow;
  onChange: (value: UpdatedWindow) => void;
}

export function UpdatedMenu({ value, onChange }: Props) {
  return (
    <div
      role="radiogroup"
      aria-label="Updated"
      className="w-[200px] p-1"
      onKeyDown={(e) => moveFocus(e, '[role="radio"]')}
    >
      {OPTIONS.map((option) => {
        const checked = option.value === value;
        return (
          <button
            key={option.label}
            type="button"
            role="radio"
            aria-checked={checked}
            onClick={() => onChange(option.value)}
            className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] text-secondary-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:bg-accent focus-visible:text-foreground aria-checked:font-medium aria-checked:text-foreground"
          >
            {option.label}
            {checked && (
              <Check
                className="ml-auto h-3.5 w-3.5 text-primary-ink"
                aria-hidden
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
