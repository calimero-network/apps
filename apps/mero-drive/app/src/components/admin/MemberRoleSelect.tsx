// Preset role → capability-bitmask dropdown. Members picked via
// this control get one of three standardised bitmasks; bespoke
// per-bit combinations are labelled "Custom" and read-only via
// this UI (admins needing finer control can wire a bit-by-bit
// matrix in a future surface).
//
// Presets:
//   Viewer  → READ                                   (bit 0)
//   Editor  → READ | WRITE                           (bits 0-1)
//   Admin   → READ | WRITE | CREATE_GROUP |
//             MANAGE_GROUP | INVITE_MEMBERS |
//             MANAGE_MEMBERS                         (bits 0-5)
//
// The "Custom" option represents any bitmask not matching a
// preset; the dropdown displays it when a member has an atypical
// combination (e.g. WRITE without READ, MANAGE_MEMBERS without
// INVITE_MEMBERS). Selecting Custom from the dropdown is a no-op
// — users can switch away from it but can't deliberately set it.

import React from 'react';
import { CAP } from '@/constants/config';

export const ROLE_PRESETS: { label: string; mask: number }[] = [
  { label: 'Viewer', mask: CAP.READ },
  { label: 'Editor', mask: CAP.READ | CAP.WRITE },
  {
    label: 'Admin',
    mask:
      CAP.READ |
      CAP.WRITE |
      CAP.CREATE_GROUP |
      CAP.MANAGE_GROUP |
      CAP.INVITE_MEMBERS |
      CAP.MANAGE_MEMBERS,
  },
];

interface Props {
  value: number | null;
  onChange: (nextMask: number) => void;
  disabled?: boolean;
  ariaLabel?: string;
}

export function MemberRoleSelect({
  value,
  onChange,
  disabled,
  ariaLabel,
}: Props) {
  const matched = value === null ? null : ROLE_PRESETS.find((p) => p.mask === value);
  const current = matched?.label ?? (value === null ? '' : 'Custom');

  return (
    <select
      aria-label={ariaLabel ?? 'Member role'}
      value={current}
      disabled={disabled || value === null}
      onChange={(e) => {
        const preset = ROLE_PRESETS.find((p) => p.label === e.target.value);
        if (preset) onChange(preset.mask);
        // "Custom" selection is a no-op — see file header.
      }}
      className="h-8 rounded-md border border-input bg-background px-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
    >
      {value === null && <option value="">Loading…</option>}
      {ROLE_PRESETS.map((p) => (
        <option key={p.label} value={p.label}>
          {p.label}
        </option>
      ))}
      {current === 'Custom' && <option value="Custom">Custom</option>}
    </select>
  );
}
