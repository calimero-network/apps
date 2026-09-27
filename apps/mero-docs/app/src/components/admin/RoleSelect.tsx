// The one role control on a member row, workspace or folder. A current state
// outside `options` (Custom, or a folder's core Admin) shows but cannot be picked.

import React from 'react';
import {
  ROLE_DESCRIPTIONS,
  roleDisplayLabel,
  type AccessRole,
  type ShownRole,
} from '@/lib/roles';

interface Props<R extends AccessRole> {
  /** `null` while the underlying state is loading. */
  value: ShownRole | null;
  options: readonly R[];
  onChange: (next: R) => void;
  /** Per-option veto: `null` means selectable, a string is the reason it is not. */
  reasonFor?: (role: R) => string | null;
  disabled?: boolean;
  ariaLabel: string;
}

export function RoleSelect<R extends AccessRole>({
  value,
  options,
  onChange,
  reasonFor,
  disabled,
  ariaLabel,
}: Props<R>) {
  const outside = value !== null && !options.some((r) => r === value);
  return (
    <select
      aria-label={ariaLabel}
      value={value ?? ''}
      disabled={disabled || value === null}
      title={value ? ROLE_DESCRIPTIONS[value] : undefined}
      onChange={(e) => {
        const next = options.find((r) => r === e.target.value);
        if (next && next !== value) onChange(next);
      }}
      className="h-8 w-28 shrink-0 rounded-md border border-input bg-background px-2 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
    >
      {value === null && <option value="">Loading…</option>}
      {options.map((role) => {
        const reason = role === value ? null : (reasonFor?.(role) ?? null);
        return (
          <option
            key={role}
            value={role}
            disabled={!!reason}
            title={reason ?? ROLE_DESCRIPTIONS[role]}
          >
            {roleDisplayLabel(role)}
          </option>
        );
      })}
      {outside && (
        <option value={value} disabled>
          {roleDisplayLabel(value)}
        </option>
      )}
    </select>
  );
}
