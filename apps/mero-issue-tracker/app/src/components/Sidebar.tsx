import React from 'react';
import styled from 'styled-components';
import { NavLink, useLocation } from 'react-router-dom';
import { tokens as t } from '../theme';
import { APP_ROUTE, PRODUCT_NAME } from '../config';
import AvatarGlyph from './AvatarGlyph';
import TeeBadge from './TeeBadge';
import { SelectMenu } from './Dropdown';
import type { RepoEntry } from '../hooks/useWorkspace';
import type { TeeMode } from '../utils/tee';
import type { Namespace } from '@calimero-apps/cloud';
import {
  IconAllIssues, IconMyIssues, IconBoard, IconMembers, IconLogout, IconPlus, IconRepo,
} from './icons';
import { useSignOut } from '../auth/signOut';
import { JoinSyncBanner } from '@calimero-apps/cloud';
import { nodeBasename } from '@calimero-apps/node-served';

export interface SidebarProps {
  totalIssues: number;
  membersCount: number;
  /** Relay / Replica when a TEE node backs the workspace; shown as a shield. */
  teeMode?: TeeMode | null;
  currentUser: string;
  currentUserLabel: string;
  currentUserHasAlias: boolean;
  namespaces: Namespace[];
  activeNs: string | null;
  onSelectNamespace: (id: string) => void;
  onNewNamespace: () => void;
  repos: RepoEntry[];
  /** A workspace joined this session whose repos have not arrived yet. */
  reposSyncing?: boolean;
  onDismissReposSyncing?: () => void;
  activeRepo: string | null;
  onSelectRepo: (id: string) => void;
  onAddRepo: () => void;
  /** False when this member lacks CAN_CREATE_CONTEXT in the workspace. The
   *  button is disabled rather than hidden, so the reason can be read out of
   *  the tooltip instead of the feature appearing not to exist. */
  canAddRepo: boolean;
  /** `rail`: the fixed left column on a wide screen. `drawer`: the same
   *  content in the slide-in panel a phone opens from the top bar. */
  variant?: 'rail' | 'drawer';
  /** Called after a repo is picked, so the drawer can close. */
  onPicked?: () => void;
}

/**
 * The left rail: the app mark, the workspace switcher, repos in the active
 * workspace, primary nav with live counts, and a footer with the peer-sync
 * indicator, who you are, and Log out. On a phone the same content opens as a
 * drawer from the top bar (see Shell).
 */
export default function Sidebar({
  totalIssues,
  membersCount,
  teeMode = null,
  currentUser,
  currentUserLabel,
  currentUserHasAlias,
  namespaces,
  activeNs,
  onSelectNamespace,
  onNewNamespace,
  repos,
  reposSyncing,
  onDismissReposSyncing,
  activeRepo,
  onSelectRepo,
  onAddRepo,
  canAddRepo,
  variant = 'rail',
  onPicked,
}: SidebarProps): React.ReactElement {
  const loc = useLocation();
  const signOut = useSignOut();
  const mine = loc.search.includes('assignee=me');
  const onDetail = loc.pathname.startsWith(`${APP_ROUTE}/issues/`);
  const onIssues = (loc.pathname === APP_ROUTE && !mine) || onDetail;
  const onBoard = loc.pathname === `${APP_ROUTE}/board`;
  const onMembers = loc.pathname === `${APP_ROUTE}/members`;

  const activeName = namespaces.find((n) => n.namespaceId === activeNs)?.name;

  return (
    <Aside $variant={variant} data-variant={variant}>
      <Brand>
        <img src={`${nodeBasename(new URL(window.location.href), "/")}favicon.svg`} alt="" width={30} height={30} />
        <span className="name">{PRODUCT_NAME}</span>
      </Brand>

      <Switcher>
        <span className="label">Workspace</span>
        <SelectMenu
          className="ns-ctl"
          testId="ns-switcher"
          ariaLabel="Switch workspace"
          placeholder="Pick a workspace"
          value={activeNs ?? ''}
          options={namespaces.map((n) => ({ value: n.namespaceId, label: n.name || n.namespaceId.slice(0, 8) }))}
          onChange={(v) => { if (v) onSelectNamespace(v); }}
        />
        <div className="ns-actions">
          <button data-testid="ns-create-btn" onClick={onNewNamespace}><IconPlus size={11} /> New workspace</button>
        </div>
      </Switcher>

      <Scroll>
        <Nav aria-label="Main">
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

        <Repos>
          <div className="repos-head">
            <span className="repos-title" title={activeName || undefined}>Repositories</span>
            <button
              className="repo-add"
              data-testid="repo-add-btn"
              aria-label="Add repository"
              onClick={onAddRepo}
              disabled={!canAddRepo}
              title={canAddRepo ? 'Add repository' : 'An admin has to give you permission to add repositories.'}
            ><IconPlus size={12} /></button>
          </div>
          <div className="repos-list">
            {reposSyncing ? (
              <JoinSyncBanner
                show
                what="repos"
                onDismiss={onDismissReposSyncing}
                style={{ margin: '4px 4px 8px', fontSize: 12 }}
              />
            ) : repos.length === 0 ? (
              <span className="repos-empty">No repos yet</span>
            ) : (
              repos.map((r) => (
                <button
                  key={r.contextId}
                  data-testid="repo-list-item"
                  className={`repo-item${r.contextId === activeRepo ? ' active' : ''}`}
                  onClick={() => { onSelectRepo(r.contextId); onPicked?.(); }}
                  title={r.name}
                >
                  <span className="repo-ico" aria-hidden="true"><IconRepo /></span>
                  <span className="repo-name">{r.name}</span>
                </button>
              ))
            )}
          </div>
        </Repos>
      </Scroll>

      <Footer>
        <div className="peer-sync">
          <span className="pulse-dot" aria-hidden="true" />
          <span>{membersCount} {membersCount === 1 ? 'peer' : 'peers'} <span className="mid">·</span> synced</span>
          <TeeBadge mode={teeMode} compact />
        </div>
        <div className="me-row">
          <AvatarGlyph
            seed={currentUserHasAlias ? currentUserLabel : (currentUser || 'me')}
            size="lg"
            keyFallback={!!currentUser && !currentUserHasAlias}
          />
          <span className="me-meta">
            <span className="me-name">You</span>
            <span className={`me-key${currentUserHasAlias ? '' : ' mono'}`} data-testid="current-identity-label">{currentUserLabel || '-'}</span>
          </span>
          <button type="button" className="logout" data-testid="logout-btn" onClick={signOut} aria-label="Log out" title="Log out">
            <IconLogout />
          </button>
        </div>
      </Footer>
    </Aside>
  );
}

const Aside = styled.aside<{ $variant: 'rail' | 'drawer' }>`
  display: flex; flex-direction: column; min-height: 0; overflow: hidden;
  border: 1px solid ${t.color.edge}; border-radius: 24px;
  ${({ $variant }) => ($variant === 'rail' ? `
    /* Frosted frame rail, floating inside the page like the header. Nothing in
       it is position: fixed (menus are absolute), so the blur traps nothing. */
    background: ${t.color.glass};
    -webkit-backdrop-filter: ${t.blur};
    backdrop-filter: ${t.blur};
    box-shadow: ${t.shadow};
    margin: 12px 0 12px 12px;
    height: calc(100vh - 24px);
    position: sticky;
    top: 12px;
  ` : `
    /* Floats over content, so it is solid (glass.css \`glass-float\`). */
    background: ${t.color.panel};
    box-shadow: ${t.shadowFloat};
    height: 100%;
  `)}
`;
const Brand = styled.div`
  display: flex; align-items: center; gap: 10px; padding: 18px 18px 8px;
  img { border-radius: 9px; box-shadow: 0 6px 14px -8px rgba(14, 18, 34, 0.6); flex: 0 0 auto; }
  .name { font-size: 15px; font-weight: 700; letter-spacing: -0.02em; white-space: nowrap; }
`;
const Switcher = styled.div`
  padding: 10px 12px 12px;
  .label {
    display: block; padding: 0 6px 6px; font-size: 11px; font-weight: 600; color: ${t.color.text3};
  }
  .ns-ctl { display: flex; width: 100%; }
  .ns-ctl > button {
    background: ${t.color.raised}; border: 1px solid ${t.color.border}; border-radius: 14px;
    padding: 9px 12px; box-shadow: ${t.shadowCard};
    color: ${t.color.text}; font-weight: 650; font-size: 13.5px; letter-spacing: -0.01em;
  }
  .ns-ctl > button:hover { border-color: ${t.color.borderStrong}; }
  .ns-ctl [role='listbox'] { width: 100%; }
  .ns-actions { display: flex; gap: 6px; padding-top: 8px; }
  .ns-actions button {
    display: inline-flex; align-items: center; justify-content: center; gap: 5px;
    font-family: inherit; font-size: 12px; font-weight: 600; color: ${t.color.text2};
    background: transparent; border: 1px solid ${t.color.borderStrong}; border-radius: ${t.radiusPill};
    min-height: 30px; padding: 0 10px; cursor: pointer;
    &:first-child { flex: 1 1 auto; }
    &:hover { color: ${t.color.text}; background: ${t.color.hover}; }
  }
`;
/* Nav and repos scroll together when the window is short, so the footer (and
   Log out) is always on screen. */
const Scroll = styled.div`
  flex: 1 1 auto; min-height: 0; overflow-y: auto; display: flex; flex-direction: column;
`;
const Nav = styled.nav`
  margin: 0 12px; padding: 10px 0 10px; border-top: 1px solid ${t.color.border};
  display: flex; flex-direction: column; gap: 2px;
`;
const Item = styled(NavLink)<{ $active?: boolean }>`
  display: flex; align-items: center; gap: 11px;
  min-height: 40px; padding: 0 12px; border-radius: 13px;
  color: ${t.color.text2}; font-size: 13.5px; font-weight: 550;
  transition: background 150ms ease-out, color 150ms ease-out, box-shadow 150ms ease-out;
  .ico { color: ${t.color.text3}; display: inline-flex; }
  .count {
    margin-left: auto; min-width: 22px; height: 20px; padding: 0 7px; border-radius: 999px;
    display: inline-flex; align-items: center; justify-content: center;
    font-size: 11px; font-weight: 650; color: ${t.color.text3}; background: ${t.color.raised2};
    font-variant-numeric: tabular-nums;
  }
  &:hover { background: ${t.color.hover}; color: ${t.color.text}; }
  ${({ $active }) => $active && `
    background: ${t.color.panel}; color: ${t.color.text}; font-weight: 650; box-shadow: ${t.shadowCard};
    &:hover { background: ${t.color.panel}; }
    .ico { color: ${t.color.accentText}; }
  `}
`;
const Repos = styled.div`
  margin: 0 12px; padding: 10px 0 12px; border-top: 1px solid ${t.color.border};
  .repos-head { display: flex; align-items: center; padding: 4px 6px 6px; }
  .repos-title { font-size: 11px; color: ${t.color.text3}; font-weight: 600; }
  .repo-add {
    margin-left: auto; width: 24px; height: 24px; display: grid; place-items: center;
    color: ${t.color.text2}; background: transparent; border: 1px solid ${t.color.border}; border-radius: ${t.radiusPill}; cursor: pointer;
    &:hover:not(:disabled) { background: ${t.color.hover}; color: ${t.color.text}; }
    &:disabled { opacity: 0.45; cursor: not-allowed; }
  }
  .repos-list { display: flex; flex-direction: column; gap: 2px; }
  .repos-empty { padding: 4px 6px 6px; font-size: 12px; color: ${t.color.text3}; }
  .repo-item {
    display: flex; align-items: center; gap: 9px; text-align: left; width: 100%;
    min-height: 34px; padding: 0 10px; border: none; background: transparent; border-radius: ${t.radiusSm};
    color: ${t.color.text2}; font-family: inherit; font-size: 13px; font-weight: 500; cursor: pointer;
    &:hover { background: ${t.color.hover}; color: ${t.color.text}; }
  }
  .repo-item.active { color: ${t.color.text}; font-weight: 650; background: ${t.color.accentDim}; }
  .repo-item.active .repo-ico { color: ${t.color.accentText}; }
  .repo-ico { display: inline-flex; color: ${t.color.text3}; flex: 0 0 auto; }
  .repo-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
`;
const Footer = styled.div`
  flex: 0 0 auto; margin: 0 12px; border-top: 1px solid ${t.color.border};
  padding: 12px 4px 14px; display: flex; flex-direction: column; gap: 12px;
  .peer-sync { display: flex; align-items: center; gap: 8px; padding: 0 4px; font-size: 12px; color: ${t.color.text2}; }
  .peer-sync .mid { color: ${t.color.text3}; }
  .pulse-dot {
    width: 7px; height: 7px; border-radius: 50%; background: ${t.color.done};
    position: relative; flex: 0 0 auto;
    &::after {
      content: ""; position: absolute; inset: -3px; border-radius: 50%;
      background: ${t.color.done}; opacity: 0.35; animation: pulse 2.4s ease-out infinite;
    }
  }
  @keyframes pulse {
    0% { transform: scale(0.6); opacity: 0.5; }
    70% { transform: scale(1.8); opacity: 0; }
    100% { opacity: 0; }
  }
  .me-row {
    display: flex; align-items: center; gap: 10px; padding: 8px 6px 8px 8px;
    background: ${t.color.raised}; border: 1px solid ${t.color.border}; border-radius: 16px; box-shadow: ${t.shadowCard};
  }
  .me-meta { display: flex; flex-direction: column; min-width: 0; flex: 1 1 auto; }
  .me-name { font-size: 13px; font-weight: 650; }
  .me-key { font-size: 12px; color: ${t.color.text2}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .me-key.mono { font-family: ${t.font.mono}; font-size: 11px; color: ${t.color.text3}; }
  .logout {
    flex: 0 0 auto; width: 34px; height: 34px; display: inline-grid; place-items: center;
    border: none; border-radius: ${t.radiusPill}; background: transparent; color: ${t.color.text2}; cursor: pointer;
    &:hover { background: ${t.color.badBg}; color: ${t.color.urgent}; }
    &:focus-visible { outline: none; box-shadow: 0 0 0 3px ${t.focus}; }
  }
  @media (prefers-reduced-motion: reduce) { .pulse-dot::after { animation: none; } }
`;
