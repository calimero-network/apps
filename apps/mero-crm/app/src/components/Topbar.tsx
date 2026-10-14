import React from 'react';
import styled from 'styled-components';
import { Link, useLocation } from 'react-router-dom';
import { tokens as t } from '../theme';
import { APP_ROUTE } from '../config';
import { IconMenu, IconPlus, IconSearch } from './icons';
import { SelectMenu } from './Dropdown';
import ThemeToggle from './ThemeToggle';

const TITLES: Record<string, string> = {
  '': 'Pipeline',
  '/deals': 'Deals',
  '/activities': 'Activities',
  '/contacts': 'Contacts',
  '/insights': 'Insights',
  '/settings': 'Settings',
  '/members': 'Members',
};

/** Floating top bar: view title, the active pipeline's name, the owner filter
 *  (Everyone / Mine / a teammate), client-side search, the light/dark switch,
 *  and New deal. On a phone it gains the menu button that opens the nav
 *  drawer, and the filter + search drop to a second row. */
export default function Topbar({
  onOpenNav,
  onNewDeal,
  pipelineName,
  ownerFilter,
  ownerOptions,
  myName,
  onOwnerFilterChange,
  searchQuery,
  onSearchChange,
  searchInputRef,
}: {
  /** Present on a narrow screen, where the nav lives in a drawer. */
  onOpenNav?: () => void;
  onNewDeal: () => void;
  pipelineName: string | null;
  ownerFilter: string;
  ownerOptions: string[];
  myName: string;
  onOwnerFilterChange: (owner: string) => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  searchInputRef: React.RefObject<HTMLInputElement | null>;
}): React.ReactElement {
  const loc = useLocation();
  const sub = loc.pathname.startsWith(APP_ROUTE) ? loc.pathname.slice(APP_ROUTE.length) : '';
  const onDetail = sub.startsWith('/deals/');

  let title: React.ReactNode = TITLES[sub] ?? 'Pipeline';
  if (onDetail) {
    title = (
      <>
        <Link className="crumb-link" to={`${APP_ROUTE}/deals`}>Deals</Link> <span className="sep">›</span>{' '}
        <span className="crumb">Deal</span>
      </>
    );
  }
  const filterable = ['', '/deals', '/activities'].includes(sub);

  const ownerOpts = [
    { value: '', label: 'Everyone' },
    ...(myName ? [{ value: myName, label: `Mine (${myName})` }] : []),
    ...ownerOptions.filter((o) => o !== myName).map((o) => ({ value: o, label: o })),
  ];

  return (
    <Bar>
      {onOpenNav && (
        <MenuBtn type="button" onClick={onOpenNav} aria-label="Open navigation" data-testid="mobile-nav-btn">
          <IconMenu />
        </MenuBtn>
      )}
      <Heading>
        <ViewTitle>{title}</ViewTitle>
        {pipelineName && (
          <PipelineName data-testid="pipeline-header-name" title="Active pipeline">{pipelineName}</PipelineName>
        )}
      </Heading>
      <Tools>
        {filterable && (
          <SelectMenu
            className="owner-ctl"
            testId="owner-filter"
            ariaLabel="Filter by owner"
            placeholder="Everyone"
            value={ownerFilter}
            options={ownerOpts}
            onChange={onOwnerFilterChange}
          />
        )}
        <Search>
          <span aria-hidden="true"><IconSearch /></span>
          <input
            ref={searchInputRef}
            type="text"
            placeholder="Search deals & people…"
            aria-label="Search deals and people"
            data-testid="search-input"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                onSearchChange('');
                e.currentTarget.blur();
              }
            }}
          />
          {!searchQuery && <span className="kbd">/</span>}
        </Search>
      </Tools>
      <End>
        <ThemeToggle />
        <NewBtn type="button" data-testid="open-new-deal-btn" onClick={onNewDeal} title="New deal (N)">
          <IconPlus size={13} /> Deal
        </NewBtn>
      </End>
    </Bar>
  );
}

/* Floating glass header (glass.css `glass-header`). Its blur makes it the
   containing block for fixed descendants; the only things that open from it
   are absolute-positioned dropdowns, which is fine. */
const Bar = styled.header`
  display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
  padding: 10px 10px 10px 20px; min-height: 64px; flex: 0 0 auto;
  margin: 12px 16px 0; border: 1px solid ${t.color.edge}; border-radius: 22px;
  position: sticky; top: 12px; z-index: 5;
  background: ${t.color.glass};
  -webkit-backdrop-filter: ${t.blur}; backdrop-filter: ${t.blur};
  box-shadow: ${t.shadow};
  @media (max-width: 940px) { padding-left: 8px; }
  @media (max-width: 720px) {
    margin: 10px 10px 0; padding: 8px; gap: 8px; border-radius: 20px; top: 10px;
  }
`;
const MenuBtn = styled.button`
  flex: 0 0 auto; width: 40px; height: 40px; border-radius: ${t.radiusPill};
  display: inline-grid; place-items: center; cursor: pointer;
  color: ${t.color.text}; background: ${t.color.raised}; border: 1px solid ${t.color.border};
  &:hover { background: ${t.color.hover}; }
`;
const Heading = styled.div`
  display: flex; align-items: center; gap: 10px; min-width: 0; flex: 0 1 auto;
`;
const ViewTitle = styled.div`
  margin: 0; font-size: 18px; font-weight: 700; letter-spacing: -0.025em;
  display: flex; align-items: center; gap: 8px; white-space: nowrap;
  .sep { color: ${t.color.text3}; font-weight: 400; }
  .crumb-link { color: ${t.color.text2}; text-decoration: none; &:hover { color: ${t.color.accentText}; } }
  .crumb { color: ${t.color.text}; }
  @media (max-width: 720px) { font-size: 16.5px; }
`;
const PipelineName = styled.div`
  font-size: 12px; font-weight: 600; color: ${t.color.text2}; white-space: nowrap;
  padding: 4px 10px; border-radius: ${t.radiusPill}; background: ${t.color.raised2};
  max-width: 220px; overflow: hidden; text-overflow: ellipsis;
  @media (max-width: 720px) { display: none; }
`;
const Tools = styled.div`
  margin-left: auto; display: flex; align-items: center; gap: 8px; min-width: 0;
  .owner-ctl { width: 168px; }
  .owner-ctl > button {
    background: ${t.color.raised}; border: 1px solid ${t.color.border}; border-radius: ${t.radiusPill};
    min-height: 38px; padding: 0 14px; font-size: 13px; color: ${t.color.text};
  }
  /* Second row on a phone: filter and search share the full width. */
  @media (max-width: 720px) {
    order: 3; flex: 1 1 100%; margin-left: 0;
    .owner-ctl { width: auto; flex: 0 1 46%; }
  }
`;
const Search = styled.div`
  display: flex; align-items: center; gap: 8px; min-height: 38px; flex: 0 1 260px; min-width: 0;
  background: ${t.color.raised}; border: 1px solid ${t.color.border};
  border-radius: ${t.radiusPill}; padding: 0 14px; color: ${t.color.text3};
  transition: border-color 150ms ease-out, box-shadow 150ms ease-out;
  &:focus-within { border-color: ${t.color.accentBorder}; box-shadow: 0 0 0 3px ${t.focus}; }
  input {
    background: none; border: none; outline: none; color: ${t.color.text};
    font-family: inherit; font-size: 13px; width: 100%; min-width: 0;
    &::placeholder { color: ${t.color.text3}; }
  }
  .kbd {
    font-family: ${t.font.mono}; font-size: 10.5px; color: ${t.color.text3};
    border: 1px solid ${t.color.border}; border-radius: 6px; padding: 1px 6px;
    background: ${t.color.raised2}; line-height: 1.4;
  }
  @media (max-width: 1100px) { flex-basis: 200px; }
  @media (max-width: 720px) { flex: 1 1 auto; .kbd { display: none; } }
`;
const End = styled.div`
  display: flex; align-items: center; gap: 6px; flex: 0 0 auto;
  @media (max-width: 720px) { margin-left: auto; }
`;
const NewBtn = styled.button`
  display: inline-flex; align-items: center; gap: 6px; white-space: nowrap;
  min-height: 40px; padding: 0 18px;
  border-radius: ${t.radiusPill}; border: 1px solid transparent; cursor: pointer;
  background: ${t.color.accent}; color: ${t.color.onAccent};
  font-family: inherit; font-size: 13.5px; font-weight: 650;
  box-shadow: 0 10px 24px -12px rgba(14, 18, 34, 0.6);
  transition: background 150ms ease-out;
  &:hover { background: ${t.color.accentHover}; }
  &:focus-visible { outline: none; box-shadow: 0 0 0 3px ${t.focus}; }
`;
