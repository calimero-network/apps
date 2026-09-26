import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Outlet } from 'react-router-dom';
import styled from 'styled-components';
import { useMero } from '@calimero-network/mero-react';
import { useToast } from '@calimero-network/mero-ui';
import { tokens as t } from '../../theme';
import { useWorkspace } from '../../hooks/useWorkspace';
import { useCrm } from '../../hooks/useCrm';
import { makeAliases } from '../../hooks/useAliases';
import { describeError } from '../../utils/errors';
import Shell from '../../components/Shell';
import NewDealModal, { type NewDealInput } from '../../components/NewDealModal';
import InviteModal from '../../components/InviteModal';
import JoinModal from '../../components/JoinModal';
import NamespaceCreateDialog from '../../components/NamespaceCreateDialog';
import AddPipelineDialog from '../../components/AddPipelineDialog';
import NsEmptyState from '../../components/NsEmptyState';
import AliasGate from '../../components/AliasGate';
import { usePendingInvitation } from '../../hooks/usePendingInvitation';
import type { AppCtx, NewDealDefaults } from './appContext';

/**
 * CRM root: owns workspace resolution (namespace + pipeline), the pipeline
 * data hook scoped to the active pipeline, the owner filter, and every modal. Onboarding is
 * explicit: no active namespace -> full-pane empty state (with a picker if
 * namespaces exist); a namespace with no pipeline -> add-pipeline prompt; a member
 * with no name -> blocking alias gate.
 */
export default function AppPage(): React.ReactElement | null {
  const { contextIdentity } = useMero();
  const ws = useWorkspace();
  const toast = useToast();

  // Two different ids, and they are NOT interchangeable since core rc.21.
  //
  // `currentUser` is the identity writes execute as: the backend stamps
  // created_by/author with the executor key and enforces delete/edit against
  // it, so every authorship and "is this mine" gate must use this one.
  const currentUser = ws.executorPublicKey ?? ws.selfIdentity ?? contextIdentity ?? '';
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

  const [ownerFilter, setOwnerFilter] = useState('');

  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);

  // An invitation captured from a link — however it arrived (cold-open URL, the
  // launcher's warm `deep-link` event, the PWA launch queue). Capture happens
  // before React mounts; it is REDEEMED here, because joining needs an
  // authenticated session and the workspace hook.
  //
  // The capture is sticky until acked, so this sees it whenever AppPage mounts,
  // including long after the link was opened. `resolve()` is the ack, called on
  // a successful join or an explicit cancel and never on a failure — so a
  // transient error stays retryable across a reload.
  const pendingInvitation = usePendingInvitation();
  const pendingInvite = pendingInvitation?.token ?? null;
  const forgetPendingInvite = useCallback(() => {
    pendingInvitation?.resolve();
  }, [pendingInvitation]);

  const data = useCrm({
    contextId: ws.contextId,
    executorPublicKey: ws.executorPublicKey,
  });

  // One toast per distinct problem, not one per failed read.
  //
  // `data.error` is a fresh Error object on every failure, so this effect used
  // to fire on each one — a burst of sync events during a join produced a burst
  // of identical toasts. `useCrm` withholds the transient
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

  const [newDeal, setNewDeal] = useState<NewDealDefaults | null>(null);
  const [showInvite, setShowInvite] = useState(false);
  const [showJoin, setShowJoin] = useState(false);
  const [showCreateNs, setShowCreateNs] = useState(false);
  const [showAddPipeline, setShowAddPipeline] = useState(false);
  const showNew = newDeal !== null;

  const openNewDeal = useCallback((defaults?: NewDealDefaults) => setNewDeal(defaults ?? {}), []);
  const openInvite = useCallback(() => setShowInvite(true), []);

  // `N` opens New deal; `/` focuses search. Ignored while typing or when any
  // other modal/gate is open (the modals own their own Escape).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const anyModal = showNew || showInvite || showJoin || showCreateNs || showAddPipeline;
      const tag = (e.target as HTMLElement)?.tagName;
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
      if (anyModal || typing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        setNewDeal({});
      }
      if (e.key === '/') {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [showNew, showInvite, showJoin, showCreateNs, showAddPipeline]);

  const myName = selfMember ? aliases.resolve(selfMember) : '';
  const ownerOptions = useMemo(() => {
    const names = new Set<string>();
    for (const m of ws.members) names.add(aliases.resolve(m));
    // Owners already on deals stay pickable even if that member left.
    for (const d of data.deals) if (d.owner) names.add(d.owner);
    if (myName) names.add(myName);
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [ws.members, aliases, data.deals, myName]);

  const createDeal = useCallback(
    async (input: NewDealInput) => {
      try {
        await data.act(async (c) => {
          let contactId = input.contactId;
          if (input.newContact) {
            contactId = await c.createContact({
              name: input.newContact.name,
              email: input.newContact.email,
              phone: '',
              organization: input.organization,
              job_title: '',
            });
          }
          return c.createDeal({
            title: input.title,
            value: input.value,
            organization: input.organization,
            contact_id: contactId,
            stage_id: input.stageId,
            owner: input.owner,
            expected_close: input.expectedClose,
            source: input.source,
          });
        });
      } catch (err) {
        toast.show({ variant: 'error', description: describeError(err) });
        throw err;
      }
    },
    [data, toast],
  );

  const openDeals = data.deals.filter((d) => d.status === 'open').length;
  const overdueActivities = data.activities.filter(
    (a) => !a.done && a.due_at < new Date().setHours(0, 0, 0, 0) && (!ownerFilter || a.owner === ownerFilter),
  ).length;
  const membersCount = Math.max(ws.members.length, 1);
  const activePipelineName = ws.pipelines.find((r) => r.contextId === ws.activePipeline)?.name ?? null;

  const ctx: AppCtx = {
    data, currentUser, myName, ownerOptions, members: ws.members, aliases, ownerFilter, setOwnerFilter,
    searchQuery, setSearchQuery, openNewDeal, openInvite, ws,
  };

  const sidebar = {
    openDeals,
    overdueActivities,
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
    pipelines: ws.pipelines,
    pipelinesSyncing: ws.isSyncing,
    onDismissPipelinesSyncing: ws.dismissSyncing,
    activePipeline: ws.activePipeline,
    onSelectPipeline: ws.selectPipeline,
    onAddPipeline: () => setShowAddPipeline(true),
    canAddPipeline: ws.roles.canAddPipeline,
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
            await ws.join(code);
            forgetPendingInvite();
            setShowJoin(false);
          }}
          onClose={() => { forgetPendingInvite(); setShowJoin(false); }}
        />
      )}
      {showAddPipeline && (
        <AddPipelineDialog onAdd={ws.addPipeline} onClose={() => setShowAddPipeline(false)} />
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
  // flashed the pipeline UI over an empty workspace. Onboarding also offers a
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
      pipelineName={activePipelineName}
      onNewDeal={() => openNewDeal()}
      ownerFilter={ownerFilter}
      ownerOptions={ownerOptions}
      myName={myName}
      onOwnerFilterChange={setOwnerFilter}
      searchQuery={searchQuery}
      onSearchChange={setSearchQuery}
      searchInputRef={searchInputRef}
    >
      {ws.activePipeline ? (
        <Ready data-testid="workspace-ready">
          <Outlet context={ctx} />
        </Ready>
      ) : (
        <PipelineGate>
          <div className="panel">
            <h2>No pipeline yet</h2>
            <p>Add a pipeline to this workspace to start tracking its deals.</p>
            {ws.roles.canAddPipeline ? (
              <button className="primary" data-testid="pipeline-add-cta" onClick={() => setShowAddPipeline(true)}>Add a pipeline</button>
            ) : (
              // Honest dead end rather than a button that 403s: the person
              // cannot fix this themselves, so say who can.
              <p className="gated" data-testid="pipeline-add-denied">
                Ask a workspace admin to add one, or to give you permission to add
                pipelines.
              </p>
            )}
          </div>
        </PipelineGate>
      )}

      {aliasGate}
      {dialogs}
      {newDeal && data.stages.length > 0 && (
        <NewDealModal
          stages={data.stages}
          contacts={data.contacts}
          owners={ownerOptions}
          defaultOwner={myName}
          defaultStageId={newDeal.stageId}
          defaultContactId={newDeal.contactId}
          currency={data.settings.currency}
          onCreate={createDeal}
          onClose={() => setNewDeal(null)}
        />
      )}
      {showInvite && <InviteModal onInvite={ws.invite} onClose={() => setShowInvite(false)} />}
    </Shell>
  );
}

// Fills the main column and carries the workspace-ready marker the e2e harness
// waits on.
const Ready = styled.div`
  display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0;
`;
const PipelineGate = styled.div`
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
      &:hover { background: #b6ff5e; }
    }
  }
`;
