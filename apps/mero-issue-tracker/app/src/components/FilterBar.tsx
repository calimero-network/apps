import React, { useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { useNavigate } from 'react-router-dom';
import { tokens as t, STATUSES, PRIORITIES } from '../theme';
import { APP_ROUTE } from '../config';
import { useAppCtx } from '../pages/app/appContext';
import { ChevronDown } from './icons';

/**
 * Status / Priority / Assignee / Label filter chips with dropdowns, active-filter
 * chips, and Clear. Status/Assignee/Label drive the server-side list_issues
 * params; Priority is applied client-side (no server param exists for it).
 */
export default function FilterBar(): React.ReactElement {
  const { filters, setFilter, clearFilters, myIssues } = useAppCtx();
  const navigate = useNavigate();
  const [open, setOpen] = useState<string | null>(null);
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) setOpen(null);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(null); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const toggle = (id: string) => setOpen((cur) => (cur === id ? null : id));
  const setMine = () => { setOpen(null); navigate({ pathname: APP_ROUTE, search: '?assignee=me' }); };
  const clearMine = () => navigate(APP_ROUTE);

  return (
    <Bar ref={barRef}>
      <ChipButton onClick={() => toggle('status')} $active={open === 'status'}>
        Status <ChevronDown size={9} />
        {open === 'status' && (
          <Menu>
            <MenuItem onClick={() => setFilter({ status: '' })}>All statuses</MenuItem>
            {STATUSES.map((s) => (
              <MenuItem key={s} onClick={() => setFilter({ status: s })}>{s}</MenuItem>
            ))}
          </Menu>
        )}
      </ChipButton>

      <ChipButton onClick={() => toggle('priority')} $active={open === 'priority'}>
        Priority <ChevronDown size={9} />
        {open === 'priority' && (
          <Menu>
            <MenuItem onClick={() => setFilter({ priority: '' })}>All priorities</MenuItem>
            {PRIORITIES.map((p) => (
              <MenuItem key={p} style={{ textTransform: 'capitalize' }} onClick={() => setFilter({ priority: p })}>{p}</MenuItem>
            ))}
          </Menu>
        )}
      </ChipButton>

      <ChipButton onClick={() => toggle('assignee')} $active={open === 'assignee'}>
        Assignee <ChevronDown size={9} />
        {open === 'assignee' && (
          <Menu onClick={(e) => e.stopPropagation()}>
            <MenuItem onClick={setMine}>Me</MenuItem>
            <MenuInput
              data-testid="filter-assignee"
              placeholder="Filter by assignee…"
              value={filters.assignee}
              onChange={(e) => setFilter({ assignee: e.target.value })}
            />
          </Menu>
        )}
      </ChipButton>

      <ChipButton onClick={() => toggle('label')} $active={open === 'label'}>
        Label <ChevronDown size={9} />
        {open === 'label' && (
          <Menu onClick={(e) => e.stopPropagation()}>
            <MenuInput
              data-testid="filter-label"
              placeholder="Filter by label…"
              value={filters.label}
              onChange={(e) => setFilter({ label: e.target.value })}
            />
          </Menu>
        )}
      </ChipButton>

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
  position: relative;
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
const Menu = styled.div`
  position: absolute; top: calc(100% + 5px); left: 0; z-index: 20;
  min-width: 172px; padding: 5px;
  background: ${t.color.raised}; border: 1px solid ${t.color.borderStrong};
  border-radius: ${t.radius}; box-shadow: 0 12px 30px rgba(0,0,0,0.5);
  display: flex; flex-direction: column; gap: 1px;
  text-align: left;
`;
const MenuItem = styled.button`
  display: block; width: 100%; text-align: left;
  font-size: 12.5px; color: ${t.color.text2};
  background: none; border: none; border-radius: 4px; padding: 6px 8px;
  &:hover { background: rgba(255,255,255,0.05); color: ${t.color.text}; }
`;
const MenuInput = styled.input`
  margin-top: 2px; width: 100%;
  background: ${t.color.bg}; border: 1px solid ${t.color.border};
  border-radius: 4px; padding: 6px 8px; color: ${t.color.text};
  font-family: inherit; font-size: 12.5px; outline: none;
  &::placeholder { color: ${t.color.text3}; }
  &:focus { border-color: ${t.color.borderStrong}; }
`;
