import React from 'react';
import styled from 'styled-components';
import { useLocation } from 'react-router-dom';
import { tokens as t } from '../theme';
import { APP_ROUTE } from '../config';
import { truncateKey } from '../utils/display';
import { IconSearch } from './icons';

/** Sticky top bar: contextual view title, the active repo's GitHub link,
 *  disabled search, New-issue button. */
export default function Topbar({
  onNewIssue,
  repoName,
  repoUrl,
}: {
  onNewIssue: () => void;
  repoName: string | null;
  repoUrl: string;
}): React.ReactElement {
  const loc = useLocation();
  const detailMatch = loc.pathname.match(new RegExp(`${APP_ROUTE}/issues/(.+)$`));

  let title: React.ReactNode = 'All Issues';
  if (detailMatch) {
    title = (
      <>
        All Issues <span className="sep">›</span>{' '}
        <span className="crumb mono">{truncateKey(decodeURIComponent(detailMatch[1]))}</span>
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
      <ViewTitle>{title}</ViewTitle>
      {repoName && (
        <RepoLink>
          <span className="repo-name" data-testid="repo-header-name">{repoName}</span>
          {repoUrl && (
            <a
              className="repo-gh"
              data-testid="repo-header-link"
              href={repoUrl}
              target="_blank"
              rel="noreferrer noopener"
            >
              {repoUrl.replace(/^https?:\/\//, '')}
            </a>
          )}
        </RepoLink>
      )}
      <Search>
        <span aria-hidden="true"><IconSearch /></span>
        <input type="text" placeholder="Search issues…" aria-label="Search issues" />
        <span className="kbd">/</span>
      </Search>
      <NewBtn type="button" data-testid="open-new-issue-btn" onClick={onNewIssue}>New issue <span className="kbd">C</span></NewBtn>
    </Bar>
  );
}

const Bar = styled.div`
  display: flex; align-items: center; gap: 14px;
  padding: 0 16px; height: 48px;
  border-bottom: 1px solid ${t.color.border};
  position: sticky; top: 0; background: ${t.color.bg}; z-index: 5;
`;
const ViewTitle = styled.div`
  font-size: 13.5px; font-weight: 600; letter-spacing: -0.01em;
  display: flex; align-items: center; gap: 8px;
  .sep { color: ${t.color.text3}; font-weight: 400; }
  .crumb { color: ${t.color.text2}; font-weight: 500; font-size: 12px; }
  .mono { font-family: ${t.font.mono}; }
`;
const RepoLink = styled.div`
  display: flex; align-items: center; gap: 8px; min-width: 0;
  padding-left: 12px; margin-left: 2px; border-left: 1px solid ${t.color.border};
  .repo-name { font-size: 12.5px; font-weight: 600; color: ${t.color.text2}; white-space: nowrap; }
  .repo-gh {
    font-size: 11.5px; color: ${t.color.text3}; font-family: ${t.font.mono};
    max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    &:hover { color: ${t.color.accent}; text-decoration: underline; }
  }
  @media (max-width: 940px) { .repo-gh { display: none; } }
`;
const Search = styled.div`
  margin-left: auto; display: flex; align-items: center; gap: 8px;
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
  @media (max-width: 940px) { width: 160px; }
`;
const NewBtn = styled.button`
  display: inline-flex; align-items: center; gap: 7px;
  border-radius: ${t.radius}; border: 1px solid transparent;
  background: ${t.color.accent}; color: ${t.color.onAccent};
  font-size: 12.5px; font-weight: 600; padding: 6px 11px;
  transition: background 150ms ease-out;
  &:hover { background: #b6ff5e; }
  .kbd {
    font-family: ${t.font.mono}; font-size: 10.5px;
    background: rgba(0,0,0,0.18); border: 1px solid rgba(0,0,0,0.16);
    color: #24350f; border-radius: 4px; padding: 1px 5px; line-height: 1.4;
  }
`;
