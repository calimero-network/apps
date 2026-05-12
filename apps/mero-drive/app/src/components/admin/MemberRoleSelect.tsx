// Preset role → capability-bitmask dropdown. Members picked via
// this control get one of three standardised *namespace-level*
// bitmasks; bespoke per-bit combinations are labelled "Custom"
// and read-only via this UI (admins needing finer control can
// wire a bit-by-bit matrix in a future surface).
//
// Presets (core's `MemberCapabilities` bits — see design spec §5.3):
//   Viewer   → CAN_JOIN_OPEN_SUBGROUPS
//   Editor   → + CAN_CREATE_SUBGROUP | CAN_CREATE_CONTEXT
//   Manager  → + CAN_INVITE_MEMBERS | MANAGE_MEMBERS |
//              CAN_MANAGE_VISIBILITY | CAN_DELETE_SUBGROUP |
//              CAN_MANAGE_METADATA
//
// "Admin" here means the core group-admin *role* (bypasses the
// bitmask entirely) — that's handled by the caller, not this
// dropdown. The "Custom" option represents any bitmask not
// matching a preset; the dropdown displays it when a member has
// an atypical combination. Selecting Custom is a no-op — users
// can switch away from it but can't deliberately set it.

import React from 'react';
import { CAPABILITIES, DEFAULT_NEW_MEMBER_CAPS } from '@/constants/config';

const C = CAPABILITIES;
// The "Editor" preset == the namespace's default new-member caps
// (kept in one place: constants/config.ts). = CAN_JOIN_OPEN_SUBGROUPS
// | CAN_CREATE_SUBGROUP | CAN_CREATE_CONTEXT (37).
const EDITOR_MASK = DEFAULT_NEW_MEMBER_CAPS;

export const ROLE_PRESETS: { label: string; mask: number }[] = [
  { label: 'Viewer', mask: C.CAN_JOIN_OPEN_SUBGROUPS },
  { label: 'Editor', mask: EDITOR_MASK },
  {
    label: 'Manager',
    mask:
      EDITOR_MASK |
      C.CAN_INVITE_MEMBERS |
      C.MANAGE_MEMBERS |
      C.CAN_MANAGE_VISIBILITY |
      C.CAN_DELETE_SUBGROUP |
      C.CAN_MANAGE_METADATA,
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
