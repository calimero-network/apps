import React from 'react';
import styled from 'styled-components';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { tokens as t } from '../theme';
import { APP_ROUTE } from '../config';
import { IconSearch } from './icons';
import { Popover, MenuItem } from './Dropdown';

const TITLES: Array<[string, string]> = [
  ['/sales', 'Sales'],
  ['/purchases', 'Purchases'],
  ['/bank', 'Bank'],
  ['/contacts', 'Contacts'],
  ['/accounting', 'Accounting'],
  ['/reports', 'Reports'],
  ['/settings', 'Settings'],
  ['/members', 'Members'],
];

/** What the + New menu creates, and where each one is made. */
const NEW_ITEMS: Array<{ label: string; to: string; testId: string }> = [
  { label: 'Invoice', to: '/sales/new', testId: 'new-invoice' },
  { label: 'Bill', to: '/purchases/new', testId: 'new-bill' },
  { label: 'Spend money', to: '/bank?new=spend', testId: 'new-spend' },
  { label: 'Receive money', to: '/bank?new=receive', testId: 'new-receive' },
  { label: 'Transfer money', to: '/bank?new=transfer', testId: 'new-transfer' },
  { label: 'Contact', to: '/contacts?new=1', testId: 'new-contact' },
  { label: 'Manual journal', to: '/accounting?tab=journals&new=1', testId: 'new-journal' },
];

/** Sticky top bar: view title (with a crumb back on detail pages), the active
 *  organisation's name, client-side search, and the + New menu. */
export default function Topbar({
  organisationName,
  searchQuery,
  onSearchChange,
  searchInputRef,
}: {
  organisationName: string | null;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  searchInputRef: React.RefObject<HTMLInputElement | null>;
}): React.ReactElement {
  const loc = useLocation();
  const navigate = useNavigate();
  const sub = loc.pathname.startsWith(APP_ROUTE) ? loc.pathname.slice(APP_ROUTE.length) : '';
  const section = TITLES.find(([p]) => sub === p || sub.startsWith(`${p}/`));
  const onDetail = section && sub.length > section[0].length;

  let title: React.ReactNode = section?.[1] ?? 'Dashboard';
  if (section && onDetail) {
    title = (
      <>
        <Link className="crumb-link" to={`${APP_ROUTE}${section[0]}`}>{section[1]}</Link>
        <span className="sep">›</span>
        <span className="crumb">{sub.endsWith('/new') ? 'New' : 'Detail'}</span>
      </>
    );
  }
  const searchable = ['/sales', '/purchases', '/contacts', '/accounting'].includes(sub);

  return (
    <Bar>
      <ViewTitle>{title}</ViewTitle>
      {organisationName && (
        <OrganisationName data-testid="organisation-header-name" title="Active organisation">{organisationName}</OrganisationName>
      )}
      <Right>
        {searchable && (
          <Search>
            <span aria-hidden="true"><IconSearch /></span>
            <input
              ref={searchInputRef}
              type="text"
              placeholder="Search…"
              aria-label="Search"
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
        )}
        <Popover
          trigger={({ toggle }) => (
            <NewBtn type="button" data-testid="new-menu-btn" onClick={toggle} title="Create something">
              + New
            </NewBtn>
          )}
        >
          {({ close }) => (
            <>
              {NEW_ITEMS.map((item) => (
                <MenuItem
                  key={item.testId}
                  type="button"
                  data-testid={item.testId}
                  onClick={() => { close(); navigate(`${APP_ROUTE}${item.to}`); }}
                >
                  {item.label}
                </MenuItem>
              ))}
            </>
          )}
        </Popover>
      </Right>
    </Bar>
  );
}

const Bar = styled.div`
  display: flex; align-items: center; gap: 14px;
  padding: 0 20px; height: 52px; flex: 0 0 auto;
  border-bottom: 1px solid ${t.color.border};
  position: sticky; top: 0; background: ${t.color.panel}; z-index: 5;
  @media print { display: none; }
`;
const ViewTitle = styled.div`
  font-size: 14px; font-weight: 700; letter-spacing: -0.01em;
  display: flex; align-items: center; gap: 8px; white-space: nowrap;
  .sep { color: ${t.color.text3}; font-weight: 400; }
  .crumb-link { color: ${t.color.accent}; text-decoration: none; &:hover { text-decoration: underline; } }
  .crumb { color: ${t.color.text2}; font-weight: 500; font-size: 13px; }
`;
const OrganisationName = styled.div`
  font-size: 12.5px; font-weight: 600; color: ${t.color.text2}; white-space: nowrap;
  padding-left: 12px; border-left: 1px solid ${t.color.border};
  max-width: 240px; overflow: hidden; text-overflow: ellipsis;
  @media (max-width: 720px) { display: none; }
`;
const Right = styled.div`
  margin-left: auto; display: flex; align-items: center; gap: 10px; min-width: 0;
  > div:last-child > div { right: 0; left: auto; min-width: 170px; }
`;
const Search = styled.div`
  display: flex; align-items: center; gap: 8px;
  background: ${t.color.raised}; border: 1px solid ${t.color.border};
  border-radius: ${t.radius}; padding: 5px 9px; width: 220px; color: ${t.color.text3};
  &:focus-within { border-color: ${t.color.accent}; }
  input {
    background: none; border: none; outline: none; color: ${t.color.text};
    font-family: inherit; font-size: 12.5px; width: 100%;
    &::placeholder { color: ${t.color.text3}; }
  }
  .kbd {
    font-family: ${t.font.mono}; font-size: 10.5px; color: ${t.color.text3};
    border: 1px solid ${t.color.border}; border-radius: 4px; padding: 1px 5px;
    background: ${t.color.panel}; line-height: 1.4;
  }
  @media (max-width: 940px) { width: 140px; }
`;
const NewBtn = styled.button`
  display: inline-flex; align-items: center; gap: 7px; white-space: nowrap;
  border-radius: ${t.radius}; border: 1px solid transparent; cursor: pointer;
  background: ${t.color.accent}; color: ${t.color.onAccent};
  font-size: 12.5px; font-weight: 700; padding: 7px 13px;
  &:hover { background: ${t.color.accentHover}; }
`;
