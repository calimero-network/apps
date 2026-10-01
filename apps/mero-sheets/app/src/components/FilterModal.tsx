/**
 * FilterModal — pick which values of a column your filter view shows.
 * Filter views are yours alone: nobody else's sheet changes.
 */
import React, { useEffect, useState } from 'react';
import styled, { keyframes } from 'styled-components';
import { C } from '../theme';

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

const fadeIn = keyframes`from{opacity:0;}to{opacity:1;}`;
const Overlay = styled.div`
  position: fixed; inset: 0; z-index: 120; display: flex; align-items: center; justify-content: center; padding: 20px;
  background: rgba(14,20,15,0.5); backdrop-filter: blur(4px); animation: ${fadeIn} 0.18s ease both;
`;
const Dialog = styled.div`
  width: 100%; max-width: 340px; background: ${C.paper}; border: 1px solid ${C.line}; border-radius: 16px; padding: 22px;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  h3 { font-size: 17px; font-weight: 800; color: ${C.ink}; margin: 0 0 4px; }
  .sub { font-size: 12.5px; color: ${C.muted}; margin: 0 0 12px; }
  > input { width: 100%; padding: 8px 10px; font-size: 13px; color: ${C.ink}; background: ${C.paper2}; border: 1px solid ${C.line}; border-radius: 8px; }
  .bulk { display: flex; gap: 12px; margin: 8px 0; }
  .bulk button { font-size: 12px; color: ${C.greenDeep}; background: none; border: none; cursor: pointer; padding: 0; }
`;
const List = styled.ul`
  list-style: none; margin: 0; padding: 0; max-height: 260px; overflow-y: auto; border-top: 1px solid ${C.line};
  li label { display: flex; align-items: center; gap: 8px; padding: 6px 2px; font-size: 13px; color: ${C.ink}; border-bottom: 1px solid ${C.line}; }
  em { color: ${C.muted}; }
`;
const Apply = styled.button`
  width: 100%; margin-top: 12px; padding: 10px; font-size: 13px; font-weight: 600; border-radius: 10px; cursor: pointer;
  color: ${C.onAccent}; background: ${C.green}; border: 1px solid #93e60c;
`;
