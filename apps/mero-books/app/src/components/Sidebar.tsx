import React from 'react';
import styled from 'styled-components';
import { NavLink, useLocation } from 'react-router-dom';
import { tokens as t } from '../theme';
import { APP_ROUTE } from '../config';
import AvatarGlyph from './AvatarGlyph';
import { SelectMenu } from './Dropdown';
import type { OrganisationEntry } from '../hooks/useWorkspace';
import type { Namespace } from '@calimero-network/mero-react';
import {
  IconDashboard, IconSales, IconPurchases, IconBank, IconContacts, IconLedger, IconReports, IconSettings, IconMembers,
} from './icons';
import { JoinSyncBanner } from '@calimero-apps/join-sync';

export interface SidebarProps {
  /** Approved sales invoices past their due date. */
  overdueInvoices: number;
  /** Approved bills past their due date. */
  overdueBills: number;
  contactsCount: number;
  membersCount: number;
  currentUser: string;
  currentUserLabel: string;
  currentUserHasAlias: boolean;
  namespaces: Namespace[];
  activeNs: string | null;
  onSelectNamespace: (id: string) => void;
  onNewNamespace: () => void;
  onJoinNamespace: () => void;
  organisations: OrganisationEntry[];
  /** A workspace joined this session whose organisations have not arrived yet. */
  organisationsSyncing?: boolean;
  onDismissOrganisationsSyncing?: () => void;
  activeOrganisation: string | null;
  onSelectOrganisation: (id: string) => void;
  onAddOrganisation: () => void;
  /** False when this member lacks CAN_CREATE_CONTEXT in the workspace. The
   *  button is disabled rather than hidden, so the reason can be read out of
   *  the tooltip instead of the feature appearing not to exist. */
  canAddOrganisation: boolean;
}

/**
 * Fixed left rail: workspace switcher, the organisations in it, primary
 * nav with live counts, and a footer with the peer-sync indicator + identity.
 */
export default function Sidebar({
  overdueInvoices,
  overdueBills,
  contactsCount,
  membersCount,
  currentUser,
  currentUserLabel,
  currentUserHasAlias,
  namespaces,
  activeNs,
  onSelectNamespace,
  onNewNamespace,
  onJoinNamespace,
  organisations,
  organisationsSyncing,
  onDismissOrganisationsSyncing,
  activeOrganisation,
  onSelectOrganisation,
  onAddOrganisation,
  canAddOrganisation,
}: SidebarProps): React.ReactElement {
  const loc = useLocation();
  const sub = loc.pathname.startsWith(APP_ROUTE) ? loc.pathname.slice(APP_ROUTE.length) : '';
  const is = (path: string) => (path === '' ? sub === '' : sub === path || sub.startsWith(`${path}/`));

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

      <Organisations>
        <div className="organisations-head">
          <span className="organisations-title" title={activeName || undefined}>Organisations</span>
          <button
            className="organisation-add"
            data-testid="organisation-add-btn"
            aria-label="Add organisation"
            onClick={onAddOrganisation}
            disabled={!canAddOrganisation}
            title={canAddOrganisation ? 'Add organisation' : 'An admin has to give you permission to add organisations.'}
          >+</button>
        </div>
        <div className="organisations-list">
          {organisationsSyncing ? (
            <JoinSyncBanner
              show
              what="organisations"
              onDismiss={onDismissOrganisationsSyncing}
              style={{ margin: '4px 8px 8px', fontSize: 12 }}
            />
          ) : organisations.length === 0 ? (
            <span className="organisations-empty">No organisations yet</span>
          ) : (
            organisations.map((r) => (
              <button
                key={r.contextId}
                data-testid="organisation-list-item"
                className={`organisation-item${r.contextId === activeOrganisation ? ' active' : ''}`}
                onClick={() => onSelectOrganisation(r.contextId)}
                title={r.name}
              >
                <span className="organisation-dot" aria-hidden="true" />
                <span className="organisation-name">{r.name}</span>
              </button>
            ))
          )}
        </div>
      </Organisations>

      <Nav>
        <Item to={APP_ROUTE} end $active={is('')} data-testid="nav-dashboard">
          <span className="ico"><IconDashboard /></span>
          Dashboard
        </Item>
        <Item to={`${APP_ROUTE}/sales`} $active={is('/sales')} data-testid="nav-sales">
          <span className="ico"><IconSales /></span>
          Sales
          {overdueInvoices > 0 && (
            <span className="count overdue" title={`${overdueInvoices} overdue`} data-testid="nav-overdue-invoices">{overdueInvoices}</span>
          )}
        </Item>
        <Item to={`${APP_ROUTE}/purchases`} $active={is('/purchases')} data-testid="nav-purchases">
          <span className="ico"><IconPurchases /></span>
          Purchases
          {overdueBills > 0 && (
            <span className="count overdue" title={`${overdueBills} overdue`}>{overdueBills}</span>
          )}
        </Item>
        <Item to={`${APP_ROUTE}/bank`} $active={is('/bank')} data-testid="nav-bank">
          <span className="ico"><IconBank /></span>
          Bank
        </Item>
        <Item to={`${APP_ROUTE}/contacts`} $active={is('/contacts')} data-testid="nav-contacts">
          <span className="ico"><IconContacts /></span>
          Contacts<span className="count">{contactsCount}</span>
        </Item>
        <Item to={`${APP_ROUTE}/accounting`} $active={is('/accounting')} data-testid="nav-accounting">
          <span className="ico"><IconLedger /></span>
          Accounting
        </Item>
        <Item to={`${APP_ROUTE}/reports`} $active={is('/reports')} data-testid="nav-reports">
          <span className="ico"><IconReports /></span>
          Reports
        </Item>
        <Item to={`${APP_ROUTE}/settings`} $active={is('/settings')} data-testid="nav-settings">
          <span className="ico"><IconSettings /></span>
          Settings
        </Item>
        <Item to={`${APP_ROUTE}/members`} $active={is('/members')} data-testid="nav-members">
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
  .ns-ctl > button:hover { background: ${t.color.hover}; }
  .ns-ctl > button:focus-visible { background: ${t.color.hover}; }
  .ns-actions { display: flex; gap: 6px; padding: 6px 4px 0; }
  .ns-actions button {
    flex: 1 1 auto; font-size: 11.5px; font-weight: 600; color: ${t.color.text2};
    background: ${t.color.raised}; border: 1px solid ${t.color.border}; border-radius: ${t.radiusSm};
    padding: 5px 8px; cursor: pointer;
    &:hover { color: ${t.color.text}; background: ${t.color.raised2}; }
  }
`;
const Organisations = styled.div`
  margin: 8px 6px 2px; padding: 4px 4px 0; border-top: 1px solid ${t.color.border};
  .organisations-head { display: flex; align-items: center; padding: 8px 6px 4px; }
  .organisations-title { font-size: 10.5px; letter-spacing: 0.06em; text-transform: uppercase; color: ${t.color.text3}; font-weight: 600; }
  .organisation-add {
    margin-left: auto; width: 20px; height: 20px; display: grid; place-items: center; line-height: 1;
    font-size: 15px; color: ${t.color.text3}; background: transparent; border: none; border-radius: 4px; cursor: pointer;
    &:hover { background: ${t.color.hover}; color: ${t.color.text}; }
  }
  .organisations-list { display: flex; flex-direction: column; gap: 1px; max-height: 168px; overflow-y: auto; }
  .organisations-empty { padding: 4px 8px 8px; font-size: 12px; color: ${t.color.text3}; }
  .organisation-item {
    display: flex; align-items: center; gap: 8px; text-align: left; width: 100%;
    padding: 6px 8px; border: none; background: transparent; border-radius: ${t.radiusSm};
    color: ${t.color.text2}; font-family: inherit; font-size: 12.5px; font-weight: 500; cursor: pointer;
    &:hover { background: ${t.color.hover}; color: ${t.color.text}; }
  }
  .organisation-item.active { background: ${t.color.accentDim}; color: ${t.color.text}; }
  .organisation-item.active .organisation-dot { background: ${t.color.accent}; }
  .organisation-dot { width: 6px; height: 6px; border-radius: 50%; background: ${t.color.text3}; flex: 0 0 auto; }
  .organisation-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
`;
const Nav = styled.nav`padding: 6px; display: flex; flex-direction: column; gap: 1px;`;
const Item = styled(NavLink)<{ $active?: boolean }>`
  display: flex; align-items: center; gap: 10px;
  padding: 7px 10px; border-radius: ${t.radius};
  color: ${t.color.text2}; font-size: 13px; font-weight: 500;
  transition: background 150ms ease-out, color 150ms ease-out;
  .ico { color: ${t.color.text3}; display: inline-flex; }
  .count { margin-left: auto; font-size: 11px; color: ${t.color.text3}; font-variant-numeric: tabular-nums; }
  .count.overdue {
    color: #fff; background: ${t.color.urgent}; border-radius: 999px;
    padding: 0 6px; font-weight: 700; line-height: 16px;
  }
  &:hover { background: ${t.color.hover}; color: ${t.color.text}; }
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
