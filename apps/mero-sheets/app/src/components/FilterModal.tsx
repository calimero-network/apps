/**
 * FilterModal — pick which values of a column your filter view shows.
 * Filter views are yours alone: nobody else's sheet changes.
 */
import React, { useEffect, useState } from 'react';
import styled from 'styled-components';
import { C } from '../theme';
import { dialogSurface, overlay, primaryPill } from './glass';

export default function FilterModal({
  column, values, shown, onApply, onClose,
}: {
  column: string;
  /** The column's distinct values ("" is blanks). */
  values: string[];
  /** The values currently shown. */
  shown: string[];
  onApply: (values: string[]) => void;
  onClose: () => void;
}) {
  const [picked, setPicked] = useState(() => new Set(shown.map((v) => v.toLowerCase())));
  const [search, setSearch] = useState('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const listed = values.filter((v) => v.toLowerCase().includes(search.trim().toLowerCase()));
  const toggle = (v: string) => setPicked((p) => {
    const next = new Set(p);
    if (next.has(v.toLowerCase())) next.delete(v.toLowerCase()); else next.add(v.toLowerCase());
    return next;
  });

  return (
    <Overlay onClick={onClose} role="presentation">
      <Dialog role="dialog" aria-modal="true" aria-label={`Filter ${column}`} data-testid="filter-modal" onClick={(e) => e.stopPropagation()}>
        <h3>Filter {column}</h3>
        <p className="sub">Only you see this filter.</p>
        <input aria-label="Search values" placeholder="Search" value={search} onChange={(e) => setSearch(e.target.value)} />
        <div className="bulk">
          <button type="button" onClick={() => setPicked(new Set(values.map((v) => v.toLowerCase())))}>Select all</button>
          <button type="button" onClick={() => setPicked(new Set())}>Clear</button>
        </div>
        <List>
          {listed.map((v) => (
            <li key={v}>
              <label>
                <input type="checkbox" checked={picked.has(v.toLowerCase())} onChange={() => toggle(v)} data-testid="field-filter-value" />
                {v === '' ? <em>(Blanks)</em> : v}
              </label>
            </li>
          ))}
        </List>
        <Apply type="button" data-testid="action-apply-filter"
          onClick={() => onApply(values.filter((v) => picked.has(v.toLowerCase())))}>
          Show {picked.size} of {values.length}
        </Apply>
      </Dialog>
    </Overlay>
  );
}

const Overlay = styled.div`
  ${overlay}
  z-index: 120;
  display: flex; align-items: center; justify-content: center; padding: 20px;
`;
const Dialog = styled.div`
  ${dialogSurface}
  width: 100%; max-width: 340px; padding: 22px;
  h3 { font-size: 17px; font-weight: 800; color: ${C.ink}; margin: 0 0 4px; }
  .sub { font-size: 12.5px; color: ${C.muted}; margin: 0 0 12px; }
  > input { width: 100%; padding: 8px 10px; font-size: 13px; color: ${C.ink}; background: var(--glass-sunken); border: 1px solid var(--glass-line); border-radius: 8px; }
  .bulk { display: flex; gap: 12px; margin: 8px 0; }
  .bulk button { font-size: 12px; color: ${C.greenDeep}; background: none; border: none; cursor: pointer; padding: 0; }
`;
const List = styled.ul`
  list-style: none; margin: 0; padding: 0; max-height: 260px; overflow-y: auto; border-top: 1px solid ${C.line};
  li label { display: flex; align-items: center; gap: 8px; padding: 6px 2px; font-size: 13px; color: ${C.ink}; border-bottom: 1px solid ${C.line}; }
  em { color: ${C.muted}; }
`;
const Apply = styled.button`
  ${primaryPill}
  width: 100%; margin-top: 12px;
`;
