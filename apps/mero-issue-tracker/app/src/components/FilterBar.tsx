import React from 'react';
import styled from 'styled-components';
import { useNavigate } from 'react-router-dom';
import { tokens as t, STATUSES, PRIORITIES } from '../theme';
import { APP_ROUTE } from '../config';
import { useAppCtx } from '../pages/app/appContext';
import { ChevronDown, IconFilter } from './icons';
import { Popover, MenuItem, MenuInput } from './Dropdown';

/**
 * Status / Priority / Assignee / Label filter chips with dropdowns, active-filter
 * chips, and Clear. Status/Assignee/Label drive the server-side list_issues
 * params; Priority is applied client-side (no server param exists for it).
 * `shown` is how many issues the list below is showing, said on the right.
 */
export default function FilterBar({ shown }: { shown?: number }): React.ReactElement {
  const { filters, setFilter, clearFilters, myIssues } = useAppCtx();
  const navigate = useNavigate();

  const setMine = () => navigate({ pathname: APP_ROUTE, search: '?assignee=me' });
  const clearMine = () => navigate(APP_ROUTE);

  return (
    <Bar>
      <span className="lead" aria-hidden="true"><IconFilter /></span>
      <Popover trigger={({ open, toggle }) => (
        <ChipButton data-testid="filter-chip-status" onClick={toggle} $active={open}>
          Status <ChevronDown size={9} />
        </ChipButton>
      )}>
        {({ close }) => (
          <>
            <MenuItem onClick={() => { setFilter({ status: '' }); close(); }}>All statuses</MenuItem>
            {STATUSES.map((s) => (
              <MenuItem key={s} onClick={() => { setFilter({ status: s }); close(); }}>{s}</MenuItem>
            ))}
          </>
        )}
      </Popover>

      <Popover trigger={({ open, toggle }) => (
        <ChipButton data-testid="filter-chip-priority" onClick={toggle} $active={open}>
          Priority <ChevronDown size={9} />
        </ChipButton>
      )}>
        {({ close }) => (
          <>
            <MenuItem onClick={() => { setFilter({ priority: '' }); close(); }}>All priorities</MenuItem>
            {PRIORITIES.map((p) => (
              <MenuItem key={p} style={{ textTransform: 'capitalize' }} onClick={() => { setFilter({ priority: p }); close(); }}>{p}</MenuItem>
            ))}
          </>
        )}
      </Popover>

      <Popover stopMenuClick trigger={({ open, toggle }) => (
        <ChipButton data-testid="filter-chip-assignee" onClick={toggle} $active={open}>
          Assignee <ChevronDown size={9} />
        </ChipButton>
      )}>
        {({ close }) => (
          <>
            <MenuItem onClick={() => { setMine(); close(); }}>Me</MenuItem>
            <MenuInput
              data-testid="filter-assignee"
              placeholder="Filter by assignee…"
              value={filters.assignee}
              onChange={(e) => setFilter({ assignee: e.target.value })}
            />
          </>
        )}
      </Popover>

      <Popover stopMenuClick trigger={({ open, toggle }) => (
        <ChipButton data-testid="filter-chip-label" onClick={toggle} $active={open}>
          Label <ChevronDown size={9} />
        </ChipButton>
      )}>
        <MenuInput
          data-testid="filter-label"
          placeholder="Filter by label…"
          value={filters.label}
          onChange={(e) => setFilter({ label: e.target.value })}
        />
      </Popover>

      {myIssues && <ActiveChip>Assignee: Me <X onClick={clearMine}>×</X></ActiveChip>}
      {filters.status && <ActiveChip>Status: {filters.status} <X onClick={() => setFilter({ status: '' })}>×</X></ActiveChip>}
      {filters.priority && <ActiveChip style={{ textTransform: 'capitalize' }}>Priority: {filters.priority} <X onClick={() => setFilter({ priority: '' })}>×</X></ActiveChip>}
      {filters.assignee && <ActiveChip>Assignee: {filters.assignee} <X onClick={() => setFilter({ assignee: '' })}>×</X></ActiveChip>}
      {filters.label && <ActiveChip>Label: {filters.label} <X onClick={() => setFilter({ label: '' })}>×</X></ActiveChip>}

      {(myIssues || filters.status || filters.priority || filters.assignee || filters.label) && (
        <Clear onClick={() => { clearFilters(); if (myIssues) clearMine(); }}>Clear</Clear>
      )}

      {shown !== undefined && (
        <span className="shown">{shown} {shown === 1 ? 'issue' : 'issues'}</span>
      )}
    </Bar>
  );
}

/* Chips sit straight on the page ground: no frosted strip, because a blurred
   strip would stack its dropdowns under the frosted list cards below it. */
const Bar = styled.div`
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  padding: 2px 2px 0;
  .lead { display: inline-flex; color: ${t.color.text3}; margin-right: 2px; }
  .shown {
    margin-left: auto; font-size: 12.5px; color: ${t.color.text3}; font-weight: 500;
    font-variant-numeric: tabular-nums; white-space: nowrap;
  }
  @media (max-width: 720px) { .lead { display: none; } }
`;
const baseChip = `
  display: inline-flex; align-items: center; gap: 6px; white-space: nowrap;
  font-family: inherit; font-size: 12.5px; font-weight: 600; border-radius: ${t.radiusPill};
  min-height: 32px; padding: 0 13px;
  transition: background 150ms ease-out, color 150ms ease-out, box-shadow 150ms ease-out;
`;
const ChipButton = styled.button<{ $active?: boolean }>`
  ${baseChip}
  cursor: pointer;
  color: ${({ $active }) => ($active ? t.color.text : t.color.text2)};
  background: ${t.color.raised};
  border: 1px solid ${({ $active }) => ($active ? t.color.accentBorder : t.color.border)};
  box-shadow: ${({ $active }) => ($active ? `0 0 0 3px ${t.focus}` : t.shadowCard)};
  svg { color: ${t.color.text3}; }
  &:hover { color: ${t.color.text}; border-color: ${t.color.borderStrong}; }
  &:focus-visible { outline: none; box-shadow: 0 0 0 3px ${t.focus}; }
`;
const ActiveChip = styled.span`
  ${baseChip}
  min-height: 30px; padding: 0 6px 0 12px;
  color: ${t.color.accentText};
  border: 1px solid ${t.color.accentBorder};
  background: ${t.color.accentDim};
`;
const X = styled.span`
  display: inline-grid; place-items: center; width: 20px; height: 20px; border-radius: 50%;
  color: ${t.color.accentText}; font-size: 14px; line-height: 1; cursor: pointer;
  &:hover { background: ${t.color.accentDim}; color: ${t.color.text}; }
`;
const Clear = styled.button`
  font-family: inherit; font-size: 12.5px; font-weight: 600; color: ${t.color.text2};
  background: none; border: none; border-radius: ${t.radiusPill}; padding: 6px 10px; cursor: pointer;
  &:hover { color: ${t.color.text}; background: ${t.color.hover}; }
`;
