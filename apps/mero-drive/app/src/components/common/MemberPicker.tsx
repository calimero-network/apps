// Combobox over the namespace's existing members. The "add manager" /
// "add member to restricted folder" flows used to be a raw text input
// expecting a 64-char hex pubkey; this lets the admin start typing
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

import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
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
  // Honor the `namespaceId` prop as the member-list source. In
  // mero-drive a namespace's id IS its root group id (see
  // useDriveWorkspace: `const rootGroupId = selectedNsId`), so
  // passing namespaceId here resolves to the same group the rest of
  // the app uses for namespace membership. Fall back to the
  // currently-selected workspace when the prop is unset.
  const { rootGroupId } = useDriveWorkspace();
  const groupId = namespaceId ?? rootGroupId;
  const { members } = useGroupMembers(groupId);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  // Active option index for keyboard navigation (Arrow keys) + the
  // listbox's aria-selected signal. -1 means "no active option" —
  // when the user is typing without having arrowed down yet.
  const [activeIndex, setActiveIndex] = useState(-1);
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
    setActiveIndex(-1);
    inputRef.current?.blur();
  };

  // Reset active highlight whenever the filtered list changes shape
  // — otherwise an out-of-range index can persist after typing.
  useEffect(() => {
    if (activeIndex >= matches.length) setActiveIndex(matches.length - 1);
  }, [matches.length, activeIndex]);

  // Wrapper ref used by onBlur to distinguish focus moving WITHIN the
  // picker (input → dropdown row) from focus actually leaving (Tab to
  // the next form field). Without it we'd close the dropdown the
  // instant the user reaches for a suggestion with the keyboard.
  const wrapperRef = useRef<HTMLDivElement>(null);

  return (
    <div ref={wrapperRef} className={`relative ${className ?? ''}`}>
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
        onBlur={(e) => {
          // Close only when focus genuinely leaves the picker (Tab to
          // the next field, click outside). When the user
          // mouse-selects a row, browsers report the row button as
          // `relatedTarget`; since the row lives inside wrapperRef,
          // we keep the dropdown open long enough for the row's
          // onMouseDown to commit the pick(). Replaces an earlier
          // 100ms setTimeout, which could race keyboard navigation
          // on slow machines.
          const next = e.relatedTarget as Node | null;
          if (next && wrapperRef.current?.contains(next)) return;
          setOpen(false);
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setActiveIndex(-1);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setOpen(true);
            setActiveIndex((i) =>
              matches.length === 0 ? -1 : Math.min(i + 1, matches.length - 1),
            );
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActiveIndex((i) => Math.max(i - 1, -1));
          } else if (e.key === 'Enter') {
            // Prefer the highlighted match; fall back to free-form
            // commit so the user can paste a raw pubkey and press
            // Enter without arrowing into the suggestions.
            if (activeIndex >= 0 && activeIndex < matches.length) {
              e.preventDefault();
              pick(matches[activeIndex].identity);
            } else if (query.trim()) {
              e.preventDefault();
              pick(query.trim());
            }
          } else if (e.key === 'Escape') {
            setOpen(false);
            setActiveIndex(-1);
          }
        }}
        aria-activedescendant={
          activeIndex >= 0 && matches[activeIndex]
            ? `${listboxId}-opt-${matches[activeIndex].identity}`
            : undefined
        }
        className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
      />
      {open && matches.length > 0 && (
        <ul
          id={listboxId}
          role="listbox"
          className="absolute z-50 mt-1 max-h-64 w-full overflow-auto rounded-md border border-border bg-popover py-1 shadow-md"
        >
          {matches.map((m, idx) => (
            <li
              key={m.identity}
              role="option"
              id={`${listboxId}-opt-${m.identity}`}
              aria-selected={idx === activeIndex}
            >
              <button
                type="button"
                onMouseDown={(e) => {
                  // mouseDown (not click) so we fire BEFORE the input's
                  // blur closes the dropdown. preventDefault on
                  // mouseDown keeps focus on the input.
                  e.preventDefault();
                  pick(m.identity);
                }}
                onMouseEnter={() => setActiveIndex(idx)}
                className={`flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm ${
                  idx === activeIndex ? 'bg-muted' : 'hover:bg-muted'
                }`}
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
