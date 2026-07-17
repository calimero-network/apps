import React from 'react';
import styled from 'styled-components';
import { NavLink, useLocation } from 'react-router-dom';
import { tokens as t } from '../theme';
import { APP_ROUTE } from '../config';
import AvatarGlyph from './AvatarGlyph';
import type { RepoEntry } from '../hooks/useWorkspace';
import type { Namespace } from '@calimero-network/mero-react';
import {
  LogoMark, ChevronDown, IconAllIssues, IconMyIssues, IconBoard, IconMembers,
} from './icons';

export interface SidebarProps {
  totalIssues: number;
  membersCount: number;
  currentUser: string;
  currentUserLabel: string;
  namespaces: Namespace[];
  activeNs: string | null;
  onSelectNamespace: (id: string) => void;
  onNewNamespace: () => void;
  onJoinNamespace: () => void;
  repos: RepoEntry[];
  activeRepo: string | null;
  onSelectRepo: (id: string) => void;
  onAddRepo: () => void;
}

/**
 * Fixed left rail: namespace switcher, repos in the active namespace, primary
 * nav with live counts, and a footer with the peer-sync indicator + identity.
 */
export default function Sidebar({
  totalIssues,
  membersCount,
  currentUser,
  currentUserLabel,
  namespaces,
  activeNs,
  onSelectNamespace,
  onNewNamespace,
  onJoinNamespace,
  repos,
  activeRepo,
  onSelectRepo,
  onAddRepo,
}: SidebarProps): React.ReactElement {
  const loc = useLocation();
  const mine = loc.search.includes('assignee=me');
  const onDetail = loc.pathname.startsWith(`${APP_ROUTE}/issues/`);
  const onIssues = (loc.pathname === APP_ROUTE && !mine) || onDetail;
  const onBoard = loc.pathname === `${APP_ROUTE}/board`;
  const onMembers = loc.pathname === `${APP_ROUTE}/members`;

  const activeName = namespaces.find((n) => n.namespaceId === activeNs)?.name;

  return (
    <Aside>
      <Switcher>
        <div className="ns-row">
          <LogoMark />
          <select
            className="ns-select"
            data-testid="ns-switcher"
            aria-label="Switch workspace"
            value={activeNs ?? ''}
            onChange={(e) => { if (e.target.value) onSelectNamespace(e.target.value); }}
          >
            {!activeNs && <option value="" disabled>Pick a workspace</option>}
            {namespaces.map((n) => (
              <option key={n.namespaceId} value={n.namespaceId}>
                {n.name || n.namespaceId.slice(0, 8)}
              </option>
            ))}
          </select>
          <span className="ns-chevron"><ChevronDown size={12} /></span>
        </div>
        <div className="ns-actions">
          <button data-testid="ns-create-btn" onClick={onNewNamespace}>New workspace</button>
          <button data-testid="ns-join-btn" onClick={onJoinNamespace}>Join</button>
        </div>
      </Switcher>

      <Repos>
        <div className="repos-head">
          <span className="repos-title" title={activeName || undefined}>Repositories</span>
          <button className="repo-add" data-testid="repo-add-btn" aria-label="Add repository" onClick={onAddRepo}>+</button>
        </div>
        <div className="repos-list">
          {repos.length === 0 ? (
            <span className="repos-empty">No repos yet</span>
          ) : (
            repos.map((r) => (
              <button
                key={r.contextId}
                data-testid="repo-list-item"
                className={`repo-item${r.contextId === activeRepo ? ' active' : ''}`}
                onClick={() => onSelectRepo(r.contextId)}
                title={r.name}
              >
                <span className="repo-dot" aria-hidden="true" />
                <span className="repo-name">{r.name}</span>
              </button>
            ))
          )}
        </div>
      </Repos>

      <Nav>
        <Item to={APP_ROUTE} end $active={onIssues}>
          <span className="ico"><IconAllIssues /></span>
          All Issues<span className="count">{totalIssues}</span>
        </Item>
        <Item to={{ pathname: APP_ROUTE, search: '?assignee=me' }} $active={mine} data-testid="nav-my-issues">
          <span className="ico"><IconMyIssues /></span>
          My Issues
        </Item>
        <Item to={`${APP_ROUTE}/board`} $active={onBoard}>
          <span className="ico"><IconBoard /></span>
          Board
        </Item>
        <Item to={`${APP_ROUTE}/members`} $active={onMembers} data-testid="nav-members">
          <span className="ico"><IconMembers /></span>
          Members<span className="count">{membersCount}</span>
        </Item>
      </Nav>

      <Spacer />

      <Footer>
        <div className="peer-sync">
          <span className="pulse-dot" aria-hidden="true" />
          <span>{membersCount} {membersCount === 1 ? 'peer' : 'peers'} <span className="mid">·</span> synced</span>
        </div>
        <div className="me-row">
          <AvatarGlyph seed={currentUser || 'me'} size="md" />
          <span className="me-meta">
            <span className="me-name">You</span>
            <span className="me-key" data-testid="current-identity-label">{currentUserLabel || '-'}</span>
          </span>
        </div>
      </Footer>
    </Aside>
  );
}

const Aside = styled.aside`
  background: ${t.color.panel};
  border-right: 1px solid ${t.color.border};
  display: flex;
  flex-direction: column;
  height: 100vh;
  position: sticky;
  top: 0;
  @media (max-width: 940px) { display: none; }
`;
const Switcher = styled.div`
  padding: 10px 10px 8px; margin: 2px 4px 0;
  .ns-row {
    display: flex; align-items: center; gap: 9px;
    padding: 6px 8px; border-radius: ${t.radius};
    &:hover { background: rgba(255,255,255,0.04); }
  }
  .ns-select {
    flex: 1 1 auto; min-width: 0; appearance: none; background: transparent; border: none; outline: none;
    color: ${t.color.text}; font-family: inherit; font-weight: 600; font-size: 13px; letter-spacing: -0.01em; cursor: pointer;
    option { background: ${t.color.panel}; color: ${t.color.text}; }
  }
  .ns-chevron { color: ${t.color.text3}; display: inline-flex; pointer-events: none; }
  .ns-actions { display: flex; gap: 6px; padding: 6px 4px 0; }
  .ns-actions button {
    flex: 1 1 auto; font-size: 11.5px; font-weight: 600; color: ${t.color.text2};
    background: ${t.color.raised}; border: 1px solid ${t.color.border}; border-radius: ${t.radiusSm};
    padding: 5px 8px; cursor: pointer;
    &:hover { color: ${t.color.text}; background: ${t.color.raised2}; }
  }
`;
const Repos = styled.div`
  margin: 8px 6px 2px; padding: 4px 4px 0; border-top: 1px solid ${t.color.border};
  .repos-head { display: flex; align-items: center; padding: 8px 6px 4px; }
  .repos-title { font-size: 10.5px; letter-spacing: 0.06em; text-transform: uppercase; color: ${t.color.text3}; font-weight: 600; }
  .repo-add {
    margin-left: auto; width: 20px; height: 20px; display: grid; place-items: center; line-height: 1;
    font-size: 15px; color: ${t.color.text3}; background: transparent; border: none; border-radius: 4px; cursor: pointer;
    &:hover { background: rgba(255,255,255,0.05); color: ${t.color.text}; }
  }
  .repos-list { display: flex; flex-direction: column; gap: 1px; max-height: 168px; overflow-y: auto; }
  .repos-empty { padding: 4px 8px 8px; font-size: 12px; color: ${t.color.text3}; }
  .repo-item {
    display: flex; align-items: center; gap: 8px; text-align: left; width: 100%;
    padding: 6px 8px; border: none; background: transparent; border-radius: ${t.radiusSm};
    color: ${t.color.text2}; font-family: inherit; font-size: 12.5px; font-weight: 500; cursor: pointer;
    &:hover { background: rgba(255,255,255,0.04); color: ${t.color.text}; }
  }
  .repo-item.active { background: ${t.color.accentDim}; color: ${t.color.text}; }
  .repo-item.active .repo-dot { background: ${t.color.accent}; }
  .repo-dot { width: 6px; height: 6px; border-radius: 50%; background: ${t.color.text3}; flex: 0 0 auto; }
  .repo-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
`;
const Nav = styled.nav`padding: 6px; display: flex; flex-direction: column; gap: 1px;`;
const Item = styled(NavLink)<{ $active?: boolean }>`
  display: flex; align-items: center; gap: 10px;
  padding: 7px 10px; border-radius: ${t.radius};
  color: ${t.color.text2}; font-size: 13px; font-weight: 500;
  transition: background 150ms ease-out, color 150ms ease-out;
  .ico { color: ${t.color.text3}; display: inline-flex; }
  .count { margin-left: auto; font-size: 11px; color: ${t.color.text3}; font-variant-numeric: tabular-nums; }
  &:hover { background: rgba(255,255,255,0.04); color: ${t.color.text}; }
  ${({ $active }) => $active && `
    background: ${t.color.accentDim}; color: ${t.color.text};
    .ico { color: ${t.color.accent}; }
  `}
`;
const Spacer = styled.div`flex: 1 1 auto;`;
const Footer = styled.div`
  border-top: 1px solid ${t.color.border};
  padding: 10px 12px; display: flex; flex-direction: column; gap: 10px;
  .peer-sync { display: flex; align-items: center; gap: 8px; font-size: 12px; color: ${t.color.text2}; }
  .peer-sync .mid { color: ${t.color.text3}; }
  .pulse-dot {
    width: 7px; height: 7px; border-radius: 50%; background: ${t.color.accent};
    position: relative; flex: 0 0 auto;
    &::after {
      content: ""; position: absolute; inset: -3px; border-radius: 50%;
      background: ${t.color.accent}; opacity: 0.35; animation: pulse 2.4s ease-out infinite;
    }
  }
  @keyframes pulse {
    0% { transform: scale(0.6); opacity: 0.5; }
    70% { transform: scale(1.8); opacity: 0; }
    100% { opacity: 0; }
  }
  .me-row { display: flex; align-items: center; gap: 9px; }
  .me-meta { display: flex; flex-direction: column; min-width: 0; }
  .me-name { font-size: 12.5px; font-weight: 600; }
  .me-key { font-size: 11px; color: ${t.color.text3}; font-family: ${t.font.mono}; }
  @media (prefers-reduced-motion: reduce) { .pulse-dot::after { animation: none; } }
`;
