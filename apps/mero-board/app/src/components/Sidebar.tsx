import React from 'react';
import styled from 'styled-components';
import { NavLink, useLocation } from 'react-router-dom';
import { tokens as t } from '../theme';
import { APP_ROUTE } from '../config';
import AvatarGlyph from './AvatarGlyph';
import { SelectMenu } from './Dropdown';
import type { FolderEntry } from '../hooks/useWorkspace';
import type { Namespace } from '@calimero-network/mero-react';
import {
  IconMembers,
} from './icons';
import { JoinSyncBanner } from '@calimero-apps/join-sync';

export interface SidebarProps {
  membersCount: number;
  currentUser: string;
  currentUserLabel: string;
  currentUserHasAlias: boolean;
  namespaces: Namespace[];
  activeNs: string | null;
  onSelectNamespace: (id: string) => void;
  onNewNamespace: () => void;
  onJoinNamespace: () => void;
  folders: FolderEntry[];
  /** A workspace joined this session whose folders have not arrived yet. */
  foldersSyncing?: boolean;
  onDismissFoldersSyncing?: () => void;
  activeFolder: string | null;
  onSelectFolder: (id: string) => void;
  onAddFolder: () => void;
  /** False when this member lacks CAN_CREATE_CONTEXT in the workspace. The
   *  button is disabled rather than hidden, so the reason can be read out of
   *  the tooltip instead of the feature appearing not to exist. */
  canAddFolder: boolean;
}

/**
 * Fixed left rail: namespace switcher, folders in the active namespace, primary
 * nav with live counts, and a footer with the peer-sync indicator + identity.
 */
export default function Sidebar({
  membersCount,
  currentUser,
  currentUserLabel,
  currentUserHasAlias,
  namespaces,
  activeNs,
  onSelectNamespace,
  onNewNamespace,
  onJoinNamespace,
  folders,
  foldersSyncing,
  onDismissFoldersSyncing,
  activeFolder,
  onSelectFolder,
  onAddFolder,
  canAddFolder,
}: SidebarProps): React.ReactElement {
  const loc = useLocation();
  const onMembers = loc.pathname === `${APP_ROUTE}/members`;

  const activeName = namespaces.find((n) => n.namespaceId === activeNs)?.name;

  return (
    <Aside>
      <Switcher>
        <div className="ns-row">
          <SelectMenu
            className="ns-ctl"
            testId="ns-switcher"
            ariaLabel="Switch workspace"
            placeholder="Pick a workspace"
            value={activeNs ?? ''}
            options={namespaces.map((n) => ({ value: n.namespaceId, label: n.name || n.namespaceId.slice(0, 8) }))}
            onChange={(v) => { if (v) onSelectNamespace(v); }}
          />
        </div>
        <div className="ns-actions">
          <button data-testid="ns-create-btn" onClick={onNewNamespace}>New workspace</button>
          <button data-testid="ns-join-btn" onClick={onJoinNamespace}>Join</button>
        </div>
      </Switcher>

      <FolderList>
        <div className="folders-head">
          <span className="folders-title" title={activeName || undefined}>Folders</span>
          <button
            className="folder-add"
            data-testid="folder-add-btn"
            aria-label="Add folder"
            onClick={onAddFolder}
            disabled={!canAddFolder}
            title={canAddFolder ? 'Add folder' : 'An admin has to give you permission to add folders.'}
          >+</button>
        </div>
        <div className="folders-list">
          {foldersSyncing ? (
            <JoinSyncBanner
              show
              what="folders"
              onDismiss={onDismissFoldersSyncing}
              style={{ margin: '4px 8px 8px', fontSize: 12 }}
            />
          ) : folders.length === 0 ? (
            <span className="folders-empty">No folders yet</span>
          ) : (
            folders.map((r) => (
              <button
                key={r.contextId}
                data-testid="folder-list-item"
                className={`folder-item${r.contextId === activeFolder ? ' active' : ''}`}
                onClick={() => onSelectFolder(r.contextId)}
                title={r.name}
              >
                <span className="folder-dot" aria-hidden="true" />
                <span className="folder-name">{r.name}</span>
              </button>
            ))
          )}
        </div>
      </FolderList>

      <Nav>
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
          <AvatarGlyph
            seed={currentUserHasAlias ? currentUserLabel : (currentUser || 'me')}
            size="md"
            keyFallback={!!currentUser && !currentUserHasAlias}
          />
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
    padding: 4px 4px; border-radius: ${t.radius};
  }
  .ns-ctl { flex: 1 1 auto; min-width: 0; }
  .ns-ctl > button {
    background: transparent; border: none; padding: 6px 6px; border-radius: ${t.radius};
    color: ${t.color.text}; font-weight: 600; font-size: 13px; letter-spacing: -0.01em;
  }
  .ns-ctl > button:hover { background: rgba(255,255,255,0.04); }
  .ns-ctl > button:focus-visible { background: rgba(255,255,255,0.06); }
  .ns-actions { display: flex; gap: 6px; padding: 6px 4px 0; }
  .ns-actions button {
    flex: 1 1 auto; font-size: 11.5px; font-weight: 600; color: ${t.color.text2};
    background: ${t.color.raised}; border: 1px solid ${t.color.border}; border-radius: ${t.radiusSm};
    padding: 5px 8px; cursor: pointer;
    &:hover { color: ${t.color.text}; background: ${t.color.raised2}; }
  }
`;
const FolderList = styled.div`
  margin: 8px 6px 2px; padding: 4px 4px 0; border-top: 1px solid ${t.color.border};
  .folders-head { display: flex; align-items: center; padding: 8px 6px 4px; }
  .folders-title { font-size: 10.5px; letter-spacing: 0.06em; text-transform: uppercase; color: ${t.color.text3}; font-weight: 600; }
  .folder-add {
    margin-left: auto; width: 20px; height: 20px; display: grid; place-items: center; line-height: 1;
    font-size: 15px; color: ${t.color.text3}; background: transparent; border: none; border-radius: 4px; cursor: pointer;
    &:hover { background: rgba(255,255,255,0.05); color: ${t.color.text}; }
  }
  .folders-list { display: flex; flex-direction: column; gap: 1px; max-height: 168px; overflow-y: auto; }
  .folders-empty { padding: 4px 8px 8px; font-size: 12px; color: ${t.color.text3}; }
  .folder-item {
    display: flex; align-items: center; gap: 8px; text-align: left; width: 100%;
    padding: 6px 8px; border: none; background: transparent; border-radius: ${t.radiusSm};
    color: ${t.color.text2}; font-family: inherit; font-size: 12.5px; font-weight: 500; cursor: pointer;
    &:hover { background: rgba(255,255,255,0.04); color: ${t.color.text}; }
  }
  .folder-item.active { background: ${t.color.accentDim}; color: ${t.color.text}; }
  .folder-item.active .folder-dot { background: ${t.color.accent}; }
  .folder-dot { width: 6px; height: 6px; border-radius: 50%; background: ${t.color.text3}; flex: 0 0 auto; }
  .folder-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
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
