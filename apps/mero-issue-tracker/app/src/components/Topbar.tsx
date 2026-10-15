import React from 'react';
import styled from 'styled-components';
import { Link, useLocation } from 'react-router-dom';
import { tokens as t } from '../theme';
import { APP_ROUTE } from '../config';
import { shortIssueId } from '../utils/display';
import { IconExternal, IconMenu, IconPlus, IconRepo, IconSearch } from './icons';
import ThemeToggle from './ThemeToggle';

/** Floating top bar: contextual view title, the active repo and its GitHub
 *  link, client-side issue search, the light/dark switch, New-issue button.
 *  On a phone it gains the menu button that opens the nav drawer, and search
 *  drops to a second row. */
export default function Topbar({
  onOpenNav,
  onNewIssue,
  repoName,
  repoUrl,
  searchQuery,
  onSearchChange,
  searchInputRef,
}: {
  /** Present on a narrow screen, where the nav lives in a drawer. */
  onOpenNav?: () => void;
  onNewIssue: () => void;
  repoName: string | null;
  repoUrl: string;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  searchInputRef: React.RefObject<HTMLInputElement | null>;
}): React.ReactElement {
  const loc = useLocation();
  const detailMatch = loc.pathname.match(new RegExp(`${APP_ROUTE}/issues/(.+)$`));

  let title: React.ReactNode = 'All Issues';
  if (detailMatch) {
    title = (
      <>
        <Link className="crumb-link" to={APP_ROUTE}>All Issues</Link> <span className="sep">›</span>{' '}
        <span className="crumb mono">{shortIssueId(decodeURIComponent(detailMatch[1]))}</span>
      </>
    );
  } else if (loc.pathname === `${APP_ROUTE}/board`) {
    title = 'Board';
  } else if (loc.pathname === `${APP_ROUTE}/members`) {
    title = 'Members';
  } else if (loc.search.includes('assignee=me')) {
    title = 'My Issues';
  }

  return (
    <Bar>
      {onOpenNav && (
        <MenuBtn type="button" onClick={onOpenNav} aria-label="Open navigation" data-testid="mobile-nav-btn">
          <IconMenu />
        </MenuBtn>
      )}
      <Heading>
        <ViewTitle>{title}</ViewTitle>
        {repoName && (
          <RepoChip title="Active repository">
            <span className="ico"><IconRepo /></span>
            <span className="repo-name" data-testid="repo-header-name">{repoName}</span>
            {repoUrl && (
              <a
                className="repo-gh"
                data-testid="repo-header-link"
                href={repoUrl}
                target="_blank"
                rel="noreferrer noopener"
                title={repoUrl}
              >
                <span className="gh-text">{repoUrl.replace(/^https?:\/\/(www\.)?github\.com\//, '')}</span>
                <IconExternal />
              </a>
            )}
          </RepoChip>
        )}
      </Heading>
      <Search>
        <span aria-hidden="true"><IconSearch /></span>
        <input
          ref={searchInputRef}
          type="text"
          placeholder="Search issues…"
          aria-label="Search issues"
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
      <End>
        <ThemeToggle />
        <NewBtn type="button" data-testid="open-new-issue-btn" onClick={onNewIssue} title="New issue (C)">
          <IconPlus size={13} /> New issue
        </NewBtn>
      </End>
    </Bar>
  );
}

/* Floating glass header (glass.css `glass-header`). Its blur makes it the
   containing block for fixed descendants; nothing opens from it but the
   drawer, which Shell portals to <body>. */
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
  display: flex; align-items: center; gap: 12px; min-width: 0; flex: 0 1 auto;
`;
const ViewTitle = styled.div`
  margin: 0; font-size: 18px; font-weight: 700; letter-spacing: -0.025em;
  display: flex; align-items: center; gap: 8px; white-space: nowrap; min-width: 0;
  .sep { color: ${t.color.text3}; font-weight: 400; }
  .crumb-link { color: ${t.color.text2}; text-decoration: none; &:hover { color: ${t.color.accentText}; } }
  .crumb { color: ${t.color.text}; }
  .mono { font-family: ${t.font.mono}; font-size: 14px; font-weight: 600; letter-spacing: 0; }
  @media (max-width: 720px) { font-size: 16.5px; }
`;
const RepoChip = styled.div`
  display: flex; align-items: center; gap: 7px; min-width: 0;
  padding: 4px 4px 4px 10px; border-radius: ${t.radiusPill}; background: ${t.color.raised2};
  .ico { display: inline-flex; color: ${t.color.text3}; }
  .repo-name { font-size: 12.5px; font-weight: 650; color: ${t.color.text}; white-space: nowrap; }
  .repo-gh {
    display: inline-flex; align-items: center; gap: 5px; min-width: 0;
    font-size: 11.5px; color: ${t.color.text2}; font-family: ${t.font.mono};
    padding: 3px 9px; border-radius: ${t.radiusPill}; background: ${t.color.raised};
    box-shadow: 0 0 0 1px ${t.color.border};
    &:hover { color: ${t.color.accentText}; }
  }
  .gh-text { max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  @media (max-width: 1180px) { .gh-text { display: none; } .repo-gh { padding: 4px 6px; } }
  @media (max-width: 720px) { display: none; }
`;
const Search = styled.div`
  margin-left: auto;
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
  /* Second row on a phone: search takes the full width. */
  @media (max-width: 720px) { order: 3; flex: 1 1 100%; margin-left: 0; .kbd { display: none; } }
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
  @media (max-width: 720px) { padding: 0 14px; }
`;
