// Combobox over the namespace's existing members. The "add manager" /
// "add member to restricted folder" flows used to be a raw text input
// expecting a 44-char base58 pubkey; this lets the admin start typing
// a name or a pubkey prefix and pick from the workspace member list.
// Free-form paste of an unknown pubkey still works (Enter commits the
// raw text via onSelect — the downstream form validates / sends).
//
// Props:
//   namespaceId — needed so each row can resolve its display name via
//                 <MemberLabel> (which calls useMemberDisplayName(ns, id)).
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
import { useMemberDisplayName } from '@/hooks/useMemberDisplayName';
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

// Render-time helper: gives each member's display name (or null) so
// the filter can match on it. Implemented as a child component so the
// per-row useMemberDisplayName call is colocated with its render.
function MemberRow({
  namespaceId,
  identity,
  query,
  onPick,
}: {
  namespaceId: string | null | undefined;
  identity: string;
  query: string;
  onPick: (id: string) => void;
}) {
  const { name } = useMemberDisplayName(namespaceId, identity);
  const q = query.trim().toLowerCase();
  const matches =
    q.length === 0 ||
    (name !== null && name.toLowerCase().includes(q)) ||
    identity.toLowerCase().startsWith(q);
  if (!matches) return null;
  return (
    <li role="option" aria-selected={false}>
      <button
        type="button"
        onMouseDown={(e) => {
          // mouseDown (not click) so we fire BEFORE the input's blur
          // closes the dropdown.
          e.preventDefault();
          onPick(identity);
        }}
        className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm hover:bg-muted"
      >
        <MemberLabel
          namespaceId={namespaceId}
          memberId={identity}
          className="truncate"
        />
        <code className="ml-2 truncate text-[10px] text-muted-foreground">
          {identity.slice(0, 12)}…
        </code>
      </button>
    </li>
  );
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
  const { rootGroupId } = useDriveWorkspace();
  const { members } = useGroupMembers(rootGroupId);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // Stable id so the combobox can point at the listbox via
  // aria-controls (a11y requirement on role="combobox").
  const listboxId = useId();

  const excludeSet = useMemo(() => new Set(exclude ?? []), [exclude]);
  const candidates = useMemo(
    () => members.filter((m) => !excludeSet.has(m.identity)),
    [members, excludeSet],
  );

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
          // Delay so a click on a dropdown row still registers
          // (mouseDown on the row fires before blur, but we still
          // want a hard close shortly after to avoid the dropdown
          // lingering when the user tabs away).
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
      {open && candidates.length > 0 && (
        <ul
          id={listboxId}
          role="listbox"
          className="absolute z-50 mt-1 max-h-64 w-full overflow-auto rounded-md border border-border bg-popover py-1 shadow-md"
        >
          {candidates.map((m) => (
            <MemberRow
              key={m.identity}
              namespaceId={namespaceId}
              identity={m.identity}
              query={query}
              onPick={pick}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
