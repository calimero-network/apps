import React from 'react';
import styled from 'styled-components';
import { NavLink, useLocation } from 'react-router-dom';
import { tokens as t } from '../theme';
import { APP_DISPLAY_NAME, APP_ROUTE } from '../config';
import AvatarGlyph from './AvatarGlyph';
import {
  LogoMark, ChevronDown, IconAllIssues, IconMyIssues, IconBoard, IconMembers,
} from './icons';

/**
 * Fixed left rail: workspace switcher, primary nav with live counts, and a
 * footer with the peer-sync indicator + the current identity.
 */
export default function Sidebar({
  totalIssues,
  membersCount,
  currentUser,
  currentUserLabel,
}: {
  totalIssues: number;
  membersCount: number;
  currentUser: string;
  currentUserLabel: string;
}): React.ReactElement {
  const loc = useLocation();
  const mine = loc.search.includes('assignee=me');
  // Detail lives under /issues/:id - keep the All Issues item lit there too.
  const onDetail = loc.pathname.startsWith(`${APP_ROUTE}/issues/`);
  const onIssues = (loc.pathname === APP_ROUTE && !mine) || onDetail;
  const onBoard = loc.pathname === `${APP_ROUTE}/board`;
  const onMembers = loc.pathname === `${APP_ROUTE}/members`;

  return (
    <Aside>
      <WsSwitch>
        <LogoMark />
        <span className="ws-name">{APP_DISPLAY_NAME}</span>
        <span className="ws-chevron"><ChevronDown size={12} /></span>
      </WsSwitch>

      <Nav>
        <Item to={APP_ROUTE} end $active={onIssues}>
          <span className="ico"><IconAllIssues /></span>
          All Issues<span className="count">{totalIssues}</span>
        </Item>
        <Item to={{ pathname: APP_ROUTE, search: '?assignee=me' }} $active={mine}>
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
const WsSwitch = styled.div`
  display: flex; align-items: center; gap: 9px;
  padding: 13px 12px; margin: 4px 6px;
  border-radius: ${t.radius}; cursor: pointer;
  transition: background 150ms ease-out;
  &:hover { background: rgba(255,255,255,0.04); }
  .ws-name { font-weight: 600; font-size: 13px; letter-spacing: -0.01em; }
  .ws-chevron { margin-left: auto; color: ${t.color.text3}; display: inline-flex; }
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
