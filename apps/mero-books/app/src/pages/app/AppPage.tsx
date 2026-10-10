import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Outlet } from 'react-router-dom';
import styled from 'styled-components';
import { useToast } from '@calimero-network/mero-ui';
import { shouldRetain } from '@calimero-apps/invite';
import { tokens as t } from '../../theme';
import { useWorkspace } from '../../hooks/useWorkspace';
import { useBooks } from '../../hooks/useBooks';
import { makeAliases } from '../../hooks/useAliases';
import { describeError } from '../../utils/errors';
import Shell from '../../components/Shell';
import InviteModal from '../../components/InviteModal';
import JoinModal from '../../components/JoinModal';
import NamespaceCreateDialog from '../../components/NamespaceCreateDialog';
import AddOrganisationDialog from '../../components/AddOrganisationDialog';
import NsEmptyState from '../../components/NsEmptyState';
import AliasGate from '../../components/AliasGate';
import { usePendingInvitation } from '../../hooks/usePendingInvitation';
import type { AppCtx } from './appContext';
import { documentStatus, today as todayStr } from '../../utils/books';

/**
 * Books root: owns workspace resolution (namespace + organisation), the books
 * data hook scoped to the active organisation, and the workspace modals.
 * Onboarding is explicit: no active namespace -> full-pane empty state (with a
 * picker if namespaces exist); a namespace with no organisation ->
 * add-organisation prompt; a member with no name -> blocking alias gate.
 */
export default function AppPage(): React.ReactElement | null {
  const ws = useWorkspace();
  const toast = useToast();

  // Two different ids, and they are NOT interchangeable since core rc.21.
  //
  // `currentUser` is the ACCOUNT writes are authorised as: the backend records
  // created_by/author as the account's owner stamp and enforces delete against
  // it, so every authorship and "is this mine" gate must use this one. It is
  // the same account `selfMember` names (one person, every device), not the
  // context executor key, which is per device.
  const currentUser = ws.selfIdentity ?? '';
  // `selfMember` is the namespace-member id, which is an ACCOUNT. Member
  // metadata - the display names behind `aliases` - is stored and keyed by it,
  // so every name lookup must use this one. It used to be safe to resolve a
  // name from the executor key because the two coincided; rc.21 rekeyed group
  // members from a signing PublicKey to an AccountId and they no longer do, so
  // resolving the executor key just returns a truncated key forever.
  const selfMember = ws.selfIdentity ?? '';

  const aliases = useMemo(
    () => makeAliases(ws.memberNames, ws.setMemberName, ws.refetchMembers, ws.membersLoading, ws.membersLoaded),
    [ws.memberNames, ws.setMemberName, ws.refetchMembers, ws.membersLoading, ws.membersLoaded],
  );

  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);

  // An invitation captured from a link — however it arrived (cold-open URL, the
  // launcher's warm `deep-link` event, the PWA launch queue). Capture happens
  // before React mounts; it is REDEEMED here, because joining needs an
  // authenticated session and the workspace hook.
  //
  // The capture is sticky until acked, so this sees it whenever AppPage mounts,
  // including long after the link was opened. `resolve()` is the ack, called on
  // a join (or finding we are already a member), a failure no retry can fix, or
  // an explicit cancel — never on a transient failure, so that one stays
  // retryable across a reload.
  const pendingInvitation = usePendingInvitation();
  const pendingInvite = pendingInvitation?.token ?? null;
  const forgetPendingInvite = useCallback(() => {
    pendingInvitation?.resolve();
  }, [pendingInvitation]);

  const data = useBooks({
    contextId: ws.contextId,
    executorPublicKey: ws.executorPublicKey,
  });

  // One toast per distinct problem, not one per failed read.
  //
  // `data.error` is a fresh Error object on every failure, so this effect used
  // to fire on each one — a burst of sync events during a join produced a burst
  // of identical toasts. `useBooks` withholds the transient
  // "context not initialized yet" case entirely (see utils/contextReadiness), so
  // that burst no longer reaches here at all; this dedupe is the second line of
  // defence, and it also stops a genuinely repeating failure from stacking up.
  //
  // Keyed on the MESSAGE rather than the object: identical text is the same
  // problem as far as anyone reading it is concerned. Cleared when the error
  // does, so the same failure recurring after a recovery is reported again.
  const lastToastRef = useRef<string | null>(null);
  useEffect(() => {
    if (!data.error) { lastToastRef.current = null; return; }
    const description = describeError(data.error);
    if (description === lastToastRef.current) return;
    lastToastRef.current = description;
    toast.show({ variant: 'error', description });
  }, [data.error, toast]);

  const [showInvite, setShowInvite] = useState(false);
  const [showJoin, setShowJoin] = useState(false);
  const [showCreateNs, setShowCreateNs] = useState(false);
  const [showAddOrganisation, setShowAddOrganisation] = useState(false);
  const openInvite = useCallback(() => setShowInvite(true), []);

  // `/` focuses search. Ignored while typing or when any modal/gate is open
  // (the modals own their own Escape).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const anyModal = showInvite || showJoin || showCreateNs || showAddOrganisation;
      const tag = (e.target as HTMLElement)?.tagName;
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
      if (anyModal || typing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === '/') {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [showInvite, showJoin, showCreateNs, showAddOrganisation]);

  const myName = selfMember ? aliases.resolve(selfMember) : '';
  const today = todayStr();
  const overdue = (kind: string) =>
    data.invoices.filter((i) => i.kind === kind && documentStatus(i, today) === 'overdue').length;
  const membersCount = Math.max(ws.members.length, 1);
  const activeOrganisationName = ws.organisations.find((r) => r.contextId === ws.activeOrganisation)?.name ?? null;

  const ctx: AppCtx = {
    data, currentUser, myName, members: ws.members, aliases, searchQuery, setSearchQuery, today, openInvite, ws,
  };

  const sidebar = {
    overdueInvoices: overdue('sales'),
    overdueBills: overdue('bill'),
    contactsCount: data.contacts.length,
    membersCount,
    currentUser,
    currentUserLabel: selfMember ? aliases.resolve(selfMember) : '',
    currentUserHasAlias: selfMember ? aliases.hasAlias(selfMember) : false,
    namespaces: ws.namespaces,
    activeNs: ws.activeNs,
    onSelectNamespace: ws.selectNamespace,
    onNewNamespace: () => setShowCreateNs(true),
    onJoinNamespace: () => setShowJoin(true),
    organisations: ws.organisations,
    organisationsSyncing: ws.isSyncing,
    onDismissOrganisationsSyncing: ws.dismissSyncing,
    activeOrganisation: ws.activeOrganisation,
    onSelectOrganisation: ws.selectOrganisation,
    onAddOrganisation: () => setShowAddOrganisation(true),
    canAddOrganisation: ws.roles.canAddOrganisation,
  };

  // Shared modals rendered regardless of which pane is up, so the empty-state
  // and the workspace both drive the same dialogs.
  const dialogs = (
    <>
      {showCreateNs && (
        <NamespaceCreateDialog onCreate={ws.createNamespace} onClose={() => setShowCreateNs(false)} />
      )}
      {(showJoin || pendingInvite) && (
        <JoinModal
          initialCode={pendingInvite ?? ''}
          autoSubmit={!!pendingInvite}
          onJoin={async (code) => {
            const outcome = await ws.join(code);
            // Joined, already in it, or a failure no retry can fix: the invitation
            // is finished with. A transient failure keeps it for the next load.
            if (!shouldRetain(outcome)) {
              // The ack clears the captured link this dialog was open for; keep
              // it open to say why a final failure failed.
              if (outcome.status === 'failed') setShowJoin(true);
              forgetPendingInvite();
            }
            if (outcome.status !== 'failed') setShowJoin(false);
            return outcome;
          }}
          onClose={() => { forgetPendingInvite(); setShowJoin(false); }}
        />
      )}
      {showAddOrganisation && (
        <AddOrganisationDialog onAdd={ws.addOrganisation} onClose={() => setShowAddOrganisation(false)} />
      )}
    </>
  );

  // Still resolving something that decides WHICH workspaces exist: hold off
  // (mirrors App.tsx's isLoading guard) rather than flash the picker.
  //  - `resolvingCallback`: an SSO callback context whose namespace is being
  //    looked up, right before the desktop handoff lands;
  //  - `resolvingApplicationId`: the node has not yet said which installed
  //    application this app is, and the namespace list is scoped by it.
  if (!ws.activeNs && (ws.resolvingCallback || ws.resolvingApplicationId)) return null;

  // No active namespace (none yet, or a stale/invalid prior choice): never
  // silently enter one, and never fall through to the Shell either - that
  // flashed the organisation UI over an empty workspace. Onboarding also offers a
  // picker when namespaces exist.
  if (!ws.activeNs) {
    return (
      <>
        <NsEmptyState
          namespaces={ws.namespaces}
          onSelect={ws.selectNamespace}
          onCreate={() => setShowCreateNs(true)}
          onJoin={() => setShowJoin(true)}
        />
        {dialogs}
      </>
    );
  }

  const aliasGate = (
    <AliasGate
      namespaceId={ws.activeNs}
      identity={ws.selfIdentity}
      hasName={!!ws.selfIdentity && ws.memberNames.has(ws.selfIdentity)}
      membersLoaded={ws.membersLoaded}
      onSave={ws.setMemberName}
    />
  );

  return (
    <Shell
      sidebar={sidebar}
      organisationName={data.settings.organisation_name || activeOrganisationName}
      searchQuery={searchQuery}
      onSearchChange={setSearchQuery}
      searchInputRef={searchInputRef}
    >
      {ws.activeOrganisation ? (
        <Ready data-testid="workspace-ready">
          <Outlet context={ctx} />
        </Ready>
      ) : (
        <OrganisationGate>
          <div className="panel">
            <h2>No organisation yet</h2>
            <p>Add an organisation to this workspace to start keeping its books.</p>
            {ws.roles.canAddOrganisation ? (
              <button className="primary" data-testid="organisation-add-cta" onClick={() => setShowAddOrganisation(true)}>Add an organisation</button>
            ) : (
              // Honest dead end rather than a button that 403s: the person
              // cannot fix this themselves, so say who can.
              <p className="gated" data-testid="organisation-add-denied">
                Ask a workspace admin to add one, or to give you permission to add
                organisations.
              </p>
            )}
          </div>
        </OrganisationGate>
      )}

      {aliasGate}
      {dialogs}
      {showInvite && <InviteModal onInvite={ws.invite} onClose={() => setShowInvite(false)} />}
    </Shell>
  );
}

// Fills the main column and carries the workspace-ready marker the e2e harness
// waits on.
const Ready = styled.div`
  display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0;
`;
const OrganisationGate = styled.div`
  flex: 1; display: flex; align-items: center; justify-content: center; padding: 24px;
  .panel {
    max-width: 400px; text-align: center; padding: 32px 28px;
    background: ${t.color.panel}; border: 1px solid ${t.color.border}; border-radius: 12px;
    h2 { font-size: 18px; font-weight: 600; letter-spacing: -0.02em; margin: 0 0 8px; }
    p { font-size: 13.5px; color: ${t.color.text2}; margin: 0 0 22px; line-height: 1.55; }
    p.gated { margin: 0; font-style: italic; }
    .primary {
      background: ${t.color.accent}; color: ${t.color.onAccent}; border: 1px solid transparent;
      border-radius: ${t.radius}; font-size: 13px; font-weight: 600; padding: 10px 16px; cursor: pointer;
      &:hover { background: ${t.color.accentHover}; }
    }
  }
`;
