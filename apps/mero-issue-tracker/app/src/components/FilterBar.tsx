import React from 'react';
import styled from 'styled-components';
import { useNavigate } from 'react-router-dom';
import { tokens as t, STATUSES, PRIORITIES } from '../theme';
import { APP_ROUTE } from '../config';
import { useAppCtx } from '../pages/app/appContext';
import { ChevronDown } from './icons';
import { Popover, MenuItem, MenuInput } from './Dropdown';

/**
 * Status / Priority / Assignee / Label filter chips with dropdowns, active-filter
 * chips, and Clear. Status/Assignee/Label drive the server-side list_issues
 * params; Priority is applied client-side (no server param exists for it).
 */
export default function FilterBar(): React.ReactElement {
  const { filters, setFilter, clearFilters, myIssues } = useAppCtx();
  const navigate = useNavigate();

  const setMine = () => navigate({ pathname: APP_ROUTE, search: '?assignee=me' });
  const clearMine = () => navigate(APP_ROUTE);

  return (
    <Bar>
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
    </Bar>
  );
}

const Bar = styled.div`
  display: flex; align-items: center; gap: 8px;
  padding: 9px 16px; border-bottom: 1px solid ${t.color.border};
  flex-wrap: wrap;
`;
const baseChip = `
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 12px; border-radius: ${t.radius}; padding: 4px 9px;
  transition: background 150ms ease-out, color 150ms ease-out;
`;
const ChipButton = styled.button<{ $active?: boolean }>`
  ${baseChip}
  color: ${t.color.text2};
  background: ${({ $active }) => ($active ? t.color.raised2 : t.color.raised)};
  border: 1px solid ${t.color.border};
  svg { color: ${t.color.text3}; }
  &:hover { background: ${t.color.raised2}; color: ${t.color.text}; }
`;
const ActiveChip = styled.span`
  ${baseChip}
  color: ${t.color.text};
  border: 1px solid ${t.color.accentBorder};
  background: ${t.color.accentDim};
`;
const X = styled.span`
  color: ${t.color.text3}; font-size: 13px; line-height: 1; cursor: pointer;
  &:hover { color: ${t.color.text}; }
`;
const Clear = styled.button`
  font-size: 12px; color: ${t.color.text3}; background: none; border: none; padding: 4px 6px;
  &:hover { color: ${t.color.text}; }
`;
