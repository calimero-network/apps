import React from 'react';
import styled from 'styled-components';
import { Link, useLocation } from 'react-router-dom';
import { tokens as t } from '../theme';
import { APP_ROUTE } from '../config';
import { IconSearch } from './icons';
import { SelectMenu } from './Dropdown';

const TITLES: Record<string, string> = {
  '': 'Pipeline',
  '/deals': 'Deals',
  '/activities': 'Activities',
  '/contacts': 'Contacts',
  '/insights': 'Insights',
  '/settings': 'Settings',
  '/members': 'Members',
};

/** Sticky top bar: view title, the active pipeline's name, the owner filter
 *  (Everyone / Mine / a teammate), client-side search, and New deal. */
export default function Topbar({
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
      <ViewTitle>{title}</ViewTitle>
      {pipelineName && (
        <PipelineName data-testid="pipeline-header-name" title="Active pipeline">{pipelineName}</PipelineName>
      )}
      <Right>
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
        <NewBtn type="button" data-testid="open-new-deal-btn" onClick={onNewDeal} title="New deal (N)">
          + Deal
        </NewBtn>
      </Right>
    </Bar>
  );
}

const Bar = styled.div`
  display: flex; align-items: center; gap: 14px;
  padding: 0 16px; height: 48px; flex: 0 0 auto;
  border-bottom: 1px solid ${t.color.border};
  position: sticky; top: 0; background: ${t.color.bg}; z-index: 5;
`;
const ViewTitle = styled.div`
  font-size: 13.5px; font-weight: 600; letter-spacing: -0.01em;
  display: flex; align-items: center; gap: 8px; white-space: nowrap;
  .sep { color: ${t.color.text3}; font-weight: 400; }
  .crumb-link { color: inherit; text-decoration: none; &:hover { color: #fff; } }
  .crumb { color: ${t.color.text2}; font-weight: 500; font-size: 12px; }
`;
const PipelineName = styled.div`
  font-size: 12.5px; font-weight: 600; color: ${t.color.text2}; white-space: nowrap;
  padding-left: 12px; border-left: 1px solid ${t.color.border};
  max-width: 220px; overflow: hidden; text-overflow: ellipsis;
  @media (max-width: 720px) { display: none; }
`;
const Right = styled.div`
  margin-left: auto; display: flex; align-items: center; gap: 10px; min-width: 0;
  .owner-ctl { width: 170px; }
  .owner-ctl > button {
    background: ${t.color.raised}; border: 1px solid ${t.color.border}; border-radius: ${t.radius};
    padding: 5px 9px; font-size: 12.5px; color: ${t.color.text};
  }
  @media (max-width: 720px) { .owner-ctl { display: none; } }
`;
const Search = styled.div`
  display: flex; align-items: center; gap: 8px;
  background: ${t.color.raised}; border: 1px solid ${t.color.border};
  border-radius: ${t.radius}; padding: 5px 9px; width: 240px; color: ${t.color.text3};
  transition: border-color 150ms ease-out;
  &:focus-within { border-color: ${t.color.borderStrong}; }
  input {
    background: none; border: none; outline: none; color: ${t.color.text};
    font-family: inherit; font-size: 12.5px; width: 100%;
    &::placeholder { color: ${t.color.text3}; }
  }
  .kbd {
    font-family: ${t.font.mono}; font-size: 10.5px; color: ${t.color.text3};
    border: 1px solid ${t.color.border}; border-radius: 4px; padding: 1px 5px;
    background: ${t.color.raised2}; line-height: 1.4;
  }
  @media (max-width: 940px) { width: 150px; }
`;
const NewBtn = styled.button`
  display: inline-flex; align-items: center; gap: 7px; white-space: nowrap;
  border-radius: ${t.radius}; border: 1px solid transparent; cursor: pointer;
  background: ${t.color.accent}; color: ${t.color.onAccent};
  font-size: 12.5px; font-weight: 600; padding: 6px 11px;
  transition: background 150ms ease-out;
  &:hover { background: #b6ff5e; }
`;
