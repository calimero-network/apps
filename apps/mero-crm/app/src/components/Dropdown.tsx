import React, { useCallback, useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { tokens as t } from '../theme';
import { ChevronDown, IconCheck } from './icons';

/**
 * Shared dropdown primitives. `Popover` is the raw chip-menu mechanics extracted
 * from the filter bar (open state, outside-click, Esc). `SelectMenu` builds a
 * keyboard-accessible styled replacement for a native <select> on top of it, so
 * the whole app uses one dropdown implementation instead of the OS menu.
 */

/* Close on outside-click / Escape while `open`, rooted at `ref`. */
function useDismiss(open: boolean, close: () => void, ref: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close, ref]);
}

export function Popover({
  trigger,
  children,
  stopMenuClick = false,
}: {
  trigger: (args: { open: boolean; toggle: () => void; close: () => void }) => React.ReactNode;
  children: React.ReactNode | ((args: { close: () => void }) => React.ReactNode);
  stopMenuClick?: boolean;
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, close, rootRef);

  return (
    <Root ref={rootRef}>
      {trigger({ open, toggle: () => setOpen((o) => !o), close })}
      {open && (
        <Menu onClick={stopMenuClick ? (e) => e.stopPropagation() : undefined}>
          {typeof children === 'function' ? children({ close }) : children}
        </Menu>
      )}
    </Root>
  );
}

type Opt = string | { value: string; label: string; node?: React.ReactNode };
const optValue = (o: Opt) => (typeof o === 'string' ? o : o.value);
const optLabel = (o: Opt) => (typeof o === 'string' ? o : o.label);
const optNode = (o: Opt) => (typeof o === 'string' ? o : (o.node ?? o.label));

/**
 * Styled, keyboard-accessible single-select. Enter/Space/ArrowDown open it,
 * arrows move between options, Enter/Space pick, Esc closes. `renderValue`
 * customises the trigger content (dot/glyph + text); `placeholder` shows when
 * `value` is empty.
 */
export function SelectMenu({
  value,
  options,
  onChange,
  testId,
  ariaLabel,
  placeholder = 'Select…',
  className,
  renderValue,
  renderOption,
}: {
  value: string;
  options: readonly Opt[];
  onChange: (value: string) => void;
  testId?: string;
  ariaLabel?: string;
  placeholder?: string;
  className?: string;
  renderValue?: (value: string) => React.ReactNode;
  renderOption?: (opt: Opt) => React.ReactNode;
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);
  const closeToTrigger = useCallback(() => { setOpen(false); triggerRef.current?.focus(); }, []);
  useDismiss(open, close, rootRef);

  const focusOption = (i: number) => {
    const items = menuRef.current?.querySelectorAll<HTMLElement>('[role="option"]');
    if (items && items[i]) items[i].focus();
  };

  // On open, land focus on the current value (or the first option).
  useEffect(() => {
    if (!open) return;
    const idx = Math.max(0, options.findIndex((o) => optValue(o) === value));
    const id = requestAnimationFrame(() => focusOption(idx));
    return () => cancelAnimationFrame(id);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const onTriggerKey = (e: React.KeyboardEvent) => {
    if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); setOpen(true); }
  };
  const onMenuKey = (e: React.KeyboardEvent) => {
    const items = menuRef.current?.querySelectorAll<HTMLElement>('[role="option"]');
    if (!items?.length) return;
    const cur = Array.from(items).indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); focusOption((cur + 1) % items.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); focusOption((cur - 1 + items.length) % items.length); }
    else if (e.key === 'Home') { e.preventDefault(); focusOption(0); }
    else if (e.key === 'End') { e.preventDefault(); focusOption(items.length - 1); }
    else if (e.key === 'Escape') { e.preventDefault(); closeToTrigger(); }
  };

  const pick = (v: string) => { onChange(v); closeToTrigger(); };
  const selectedOpt = options.find((o) => optValue(o) === value);
  const label = value
    ? (renderValue ? renderValue(value) : (selectedOpt ? optLabel(selectedOpt) : value))
    : <span className="ph">{placeholder}</span>;

  return (
    <Root ref={rootRef} className={className}>
      <Trigger
        ref={triggerRef}
        type="button"
        data-testid={testId}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onTriggerKey}
      >
        <span className="tv">{label}</span>
        <span className="chev"><ChevronDown size={10} /></span>
      </Trigger>
      {open && (
        <Menu ref={menuRef} role="listbox" aria-label={ariaLabel} onKeyDown={onMenuKey}>
          {options.map((o) => {
            const v = optValue(o);
            const selected = v === value;
            return (
              <Option
                key={v}
                type="button"
                role="option"
                aria-selected={selected}
                $selected={selected}
                onClick={() => pick(v)}
              >
                <span className="ov">{renderOption ? renderOption(o) : optNode(o)}</span>
                {selected && <span className="ck"><IconCheck /></span>}
              </Option>
            );
          })}
        </Menu>
      )}
    </Root>
  );
}

const Root = styled.div`position: relative; display: inline-flex; min-width: 0;`;

export const Menu = styled.div`
  position: absolute; top: calc(100% + 5px); left: 0; z-index: 20;
  min-width: 172px; padding: 5px;
  background: ${t.color.raised}; border: 1px solid ${t.color.borderStrong};
  border-radius: ${t.radius}; box-shadow: 0 12px 30px rgba(0,0,0,0.5);
  display: flex; flex-direction: column; gap: 1px;
  text-align: left;
`;
export const MenuItem = styled.button`
  display: block; width: 100%; text-align: left;
  font-size: 12.5px; color: ${t.color.text2};
  background: none; border: none; border-radius: 4px; padding: 6px 8px; cursor: pointer;
  &:hover, &:focus-visible { background: rgba(255,255,255,0.05); color: ${t.color.text}; outline: none; }
`;
export const MenuInput = styled.input`
  margin-top: 2px; width: 100%;
  background: ${t.color.bg}; border: 1px solid ${t.color.border};
  border-radius: 4px; padding: 6px 8px; color: ${t.color.text};
  font-family: inherit; font-size: 12.5px; outline: none;
  &::placeholder { color: ${t.color.text3}; }
  &:focus { border-color: ${t.color.borderStrong}; }
`;

const Trigger = styled.button`
  flex: 1 1 auto; min-width: 0;
  display: inline-flex; align-items: center; gap: 7px;
  background: ${t.color.raised}; border: 1px solid ${t.color.border};
  border-radius: ${t.radiusSm}; padding: 5px 7px; cursor: pointer;
  color: ${t.color.text}; font-family: inherit; font-size: 12.5px; text-align: left;
  transition: border-color 150ms ease-out, background 150ms ease-out;
  .tv { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    display: inline-flex; align-items: center; gap: 7px; }
  .tv .ph { color: ${t.color.text3}; }
  .chev { color: ${t.color.text3}; display: inline-flex; flex: 0 0 auto; }
  &:hover { border-color: ${t.color.borderStrong}; }
  &:focus-visible { outline: none; border-color: ${t.color.accentBorder}; }
`;
const Option = styled.button<{ $selected?: boolean }>`
  display: flex; align-items: center; gap: 7px; width: 100%; text-align: left;
  font-size: 12.5px; color: ${({ $selected }) => ($selected ? t.color.text : t.color.text2)};
  background: none; border: none; border-radius: 4px; padding: 6px 8px; cursor: pointer;
  .ov { flex: 1 1 auto; min-width: 0; display: inline-flex; align-items: center; gap: 7px; }
  .ck { color: ${t.color.accent}; display: inline-flex; flex: 0 0 auto; }
  &:hover, &:focus-visible { background: rgba(255,255,255,0.05); color: ${t.color.text}; outline: none; }
`;
