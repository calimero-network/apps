// Combobox over the namespace's existing members. The "add manager" /
// "add member to restricted folder" flows used to be a raw text input
// expecting a 44-char base58 pubkey; this lets the admin start typing
// a name or a pubkey prefix and pick from the workspace member list.
// Free-form paste of an unknown pubkey still works (Enter commits the
// raw text via onSelect — the downstream form validates / sends).
//
// Filtering happens in the parent, on the *pre-loaded* `GroupMember.name`
// field that `useGroupMembers` returns (core #2338 propagates each
// member's MetadataRecord.name into the list rows). Only the rows that
// matched render a <MemberLabel>, which itself calls useMemberDisplayName
// — so the live-metadata lookup is bounded by what's actually visible,
// not by the size of the workspace.
//
// Props:
//   namespaceId — needed so each visible row can resolve its display
//                 name via <MemberLabel>; also the scope this picker
//                 operates in.
//   onSelect    — fired with the chosen identity. The parent decides
//                 what to do (set its own state, call the server, etc).
//   exclude     — identities to omit from the dropdown (e.g. existing
//                 managers / members already in the folder).
//   placeholder — passed through to the input.
//   ariaLabel
//   disabled

import React, { useId, useMemo, useRef, useState } from 'react';
import { useGroupMembers } from '@calimero-network/mero-react';
import { useDriveWorkspace } from '@/hooks/useDriveWorkspace';
import { MemberLabel } from './MemberLabel';

interface Props {
  namespaceId: string | null | undefined;
  onSelect: (identity: string) => void;
  exclude?: string[];
  placeholder?: string;
  ariaLabel?: string;
  disabled?: boolean;
  /** Optional className passthrough on the wrapper. */
  className?: string;
}

export function MemberPicker({
  namespaceId,
  onSelect,
  exclude,
  placeholder = 'Search members or paste a pubkey…',
  ariaLabel,
  disabled,
  className,
}: Props) {
  // In mero-drive a namespace's id IS its root group id (see
  // useDriveWorkspace: `const rootGroupId = selectedNsId`), so the
  // member list and the metadata lookups happen against the same
  // group. Reading rootGroupId here keeps the hook call symmetric
  // with how the rest of the app reads namespace membership.
  const { rootGroupId } = useDriveWorkspace();
  const { members } = useGroupMembers(rootGroupId);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // Stable id so the combobox can point at the listbox via
  // aria-controls (a11y requirement on role="combobox").
  const listboxId = useId();

  const excludeSet = useMemo(() => new Set(exclude ?? []), [exclude]);

  // Filter in the parent — on the pre-loaded GroupMember.name and the
  // pubkey prefix. Only matching rows render a MemberLabel, so the
  // useMemberDisplayName fan-out is bounded by what's actually shown.
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return members.filter((m) => {
      if (excludeSet.has(m.identity)) return false;
      if (q.length === 0) return true;
      const name = m.name?.toLowerCase();
      return (
        (name !== undefined && name.includes(q)) ||
        m.identity.toLowerCase().startsWith(q)
      );
    });
  }, [members, excludeSet, query]);

  const pick = (identity: string) => {
    onSelect(identity);
    setQuery('');
    setOpen(false);
    inputRef.current?.blur();
  };

  return (
    <div className={`relative ${className ?? ''}`}>
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-label={ariaLabel ?? 'Pick a member'}
        aria-expanded={open}
        aria-controls={listboxId}
        value={query}
        placeholder={placeholder}
        disabled={disabled}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          // A row's onMouseDown calls preventDefault() before this blur
          // ever runs, so the row's pick() fires while the input keeps
          // focus. The setTimeout is just a safety belt for the rare
          // path where focus leaves via Tab / programmatic blur with
          // the dropdown still open.
          setTimeout(() => setOpen(false), 100);
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && query.trim()) {
            // Free-form commit — the parent decides whether to accept
            // (it'll validate base58 format etc).
            e.preventDefault();
            pick(query.trim());
          } else if (e.key === 'Escape') {
            setOpen(false);
          }
        }}
        className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
      />
      {open && matches.length > 0 && (
        <ul
          id={listboxId}
          role="listbox"
          className="absolute z-50 mt-1 max-h-64 w-full overflow-auto rounded-md border border-border bg-popover py-1 shadow-md"
        >
          {matches.map((m) => (
            <li key={m.identity} role="option" aria-selected={false}>
              <button
                type="button"
                onMouseDown={(e) => {
                  // mouseDown (not click) so we fire BEFORE the input's
                  // blur closes the dropdown. preventDefault on
                  // mouseDown keeps focus on the input.
                  e.preventDefault();
                  pick(m.identity);
                }}
                className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm hover:bg-muted"
              >
                <MemberLabel
                  namespaceId={namespaceId}
                  memberId={m.identity}
                  className="truncate"
                />
                <code className="ml-2 truncate text-[10px] text-muted-foreground">
                  {m.identity.slice(0, 12)}…
                </code>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
