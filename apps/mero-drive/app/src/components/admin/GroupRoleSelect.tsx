// The CORE GROUP ROLE picker: Admin / Member / ReadOnly.
//
// Distinct from `MemberRoleSelect`, which despite its name picks a CAPABILITY
// BITMASK preset. The two are separate server fields — see `lib/roles.ts` —
// and the app previously exposed only the second, so there was no way to
// promote or demote anyone at all: an Admin was an Admin because core made
// them one at creation, and stayed one forever.
//
// A disabled option still renders, with its reason in the `title`, rather than
// being hidden: "why can't I demote this person" is a question the roster
// should answer in place.

import React from 'react';
import { GROUP_ROLES, ROLE_DESCRIPTIONS, type GroupRole } from '@/lib/roles';

interface Props {
  value: GroupRole;
  onChange: (next: GroupRole) => void;
  /** Per-option veto — `null` means selectable, a string is the reason it is not. */
  reasonFor?: (role: GroupRole) => string | null;
  disabled?: boolean;
  ariaLabel?: string;
}

export function GroupRoleSelect({
  value,
  onChange,
  reasonFor,
  disabled,
  ariaLabel,
}: Props) {
  return (
    <select
      aria-label={ariaLabel ?? 'Member role'}
      value={value}
      disabled={disabled}
      title={ROLE_DESCRIPTIONS[value]}
      onChange={(e) => {
        const next = e.target.value as GroupRole;
        if (next !== value) onChange(next);
      }}
      className="h-8 rounded-md border border-input bg-background px-2 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
    >
      {GROUP_ROLES.map((role) => {
        const reason = role === value ? null : (reasonFor?.(role) ?? null);
        return (
          <option
            key={role}
            value={role}
            disabled={!!reason}
            title={reason ?? ROLE_DESCRIPTIONS[role]}
          >
            {role}
            {reason ? ' —  unavailable' : ''}
          </option>
        );
      })}
    </select>
  );
}
