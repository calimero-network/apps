import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Outlet, useSearchParams } from 'react-router-dom';
import styled from 'styled-components';
import { useMero } from '@calimero-network/mero-react';
import { useToast } from '@calimero-network/mero-ui';
import { tokens as t } from '../../theme';
import { useWorkspace } from '../../hooks/useWorkspace';
import { useIssues } from '../../hooks/useItems';
import { makeAliases } from '../../hooks/useAliases';
import { describeError } from '../../utils/errors';
import Shell from '../../components/Shell';
import NewIssueModal from '../../components/NewIssueModal';
import InviteModal from '../../components/InviteModal';
import JoinModal from '../../components/JoinModal';
import NamespaceCreateDialog from '../../components/NamespaceCreateDialog';
import AddRepoDialog from '../../components/AddRepoDialog';
import NsEmptyState from '../../components/NsEmptyState';
import AliasGate from '../../components/AliasGate';
import type { AppCtx, Filters } from './appContext';

const EMPTY_FILTERS: Filters = { status: '', priority: '', assignee: '', label: '' };

/**
 * Tracker root: owns workspace resolution (namespace + repo), the issue data
 * hook scoped to the active repo, filter state, and every modal. Onboarding is
 * explicit: no active namespace -> full-pane empty state (with a picker if
 * namespaces exist); a namespace with no repo -> add-repo prompt; a member
 * with no name -> blocking alias gate.
 */
export default function AppPage(): React.ReactElement | null {
  const { contextIdentity } = useMero();
  const ws = useWorkspace();
  const toast = useToast();
  const [searchParams] = useSearchParams();

  // Authorship + "me" gates must use the identity writes execute as: the backend
  // stamps created_by/author with the executor key and enforces delete/edit
  // against it. selfIdentity (the namespace-member key) can diverge from it under
  // namespace drift, so it is only a display fallback while the executor resolves.
  const currentUser = ws.executorPublicKey ?? ws.selfIdentity ?? contextIdentity ?? '';
  const myIssues = searchParams.get('assignee') === 'me';

  const aliases = useMemo(
    () => makeAliases(ws.memberNames, ws.setMemberName, ws.refetchMembers, ws.membersLoading, ws.membersLoaded),
    [ws.memberNames, ws.setMemberName, ws.refetchMembers, ws.membersLoading, ws.membersLoaded],
  );

  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const setFilter = useCallback((patch: Partial<Filters>) => {
    setFilters((f) => ({ ...f, ...patch }));
  }, []);
  const clearFilters = useCallback(() => setFilters(EMPTY_FILTERS), []);

  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);

  const effectiveAssignee = myIssues ? (currentUser ? aliases.resolve(currentUser) : '') : filters.assignee;
  const hookFilters = useMemo(
    () => ({ status: filters.status, assignee: effectiveAssignee, label: filters.label }),
    [filters.status, effectiveAssignee, filters.label],
  );

  const data = useIssues({
    contextId: ws.contextId,
    executorPublicKey: ws.executorPublicKey,
    filters: hookFilters,
  });

  useEffect(() => {
    if (data.error) toast.show({ variant: 'error', description: describeError(data.error) });
  }, [data.error, toast]);

  const [showNew, setShowNew] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [showJoin, setShowJoin] = useState(false);
  const [showCreateNs, setShowCreateNs] = useState(false);
  const [showAddRepo, setShowAddRepo] = useState(false);

  const openNewIssue = useCallback(() => setShowNew(true), []);
  const openInvite = useCallback(() => setShowInvite(true), []);

  // `C` opens New issue; `/` focuses search. `Esc` closes an open New-issue
  // modal. Ignore while typing or when any other modal/gate is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const anyModal = showNew || showInvite || showJoin || showCreateNs || showAddRepo;
      if (e.key === 'Escape' && showNew) { setShowNew(false); return; }
      const tag = (e.target as HTMLElement)?.tagName;
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
      if ((e.key === 'c' || e.key === 'C') && !anyModal && !typing) {
        e.preventDefault();
        setShowNew(true);
      }
      if (e.key === '/' && !anyModal && !typing) {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [showNew, showInvite, showJoin, showCreateNs, showAddRepo]);

  const createIssue = useCallback(
    async (
      title: string,
      summary: string,
      impact: string,
      repro: string,
      resolutionCriteria: string,
      priority: string,
      labels: string[],
    ) => {
      try {
        await data.createIssue(title, summary, impact, repro, resolutionCriteria, priority, labels);
      } catch (err) {
        toast.show({ variant: 'error', description: describeError(err) });
        throw err;
      }
    },
    [data, toast],
  );

  const totalIssues = Object.values(data.counts).reduce((a, b) => a + b, 0);
  const membersCount = Math.max(ws.members.length, 1);
  const activeRepoName = ws.repos.find((r) => r.contextId === ws.activeRepo)?.name ?? null;

  const ctx: AppCtx = {
    data, currentUser, members: ws.members, aliases, filters, myIssues, repoUrl: ws.repoUrl,
    searchQuery, setSearchQuery, setFilter, clearFilters, openNewIssue, openInvite, ws,
  };

  const sidebar = {
    totalIssues,
    membersCount,
    currentUser,
    currentUserLabel: currentUser ? aliases.resolve(currentUser) : '',
    currentUserHasAlias: currentUser ? aliases.hasAlias(currentUser) : false,
    namespaces: ws.namespaces,
    activeNs: ws.activeNs,
    onSelectNamespace: ws.selectNamespace,
    onNewNamespace: () => setShowCreateNs(true),
    onJoinNamespace: () => setShowJoin(true),
    repos: ws.repos,
    activeRepo: ws.activeRepo,
    onSelectRepo: ws.selectRepo,
    onAddRepo: () => setShowAddRepo(true),
  };

  // Shared modals rendered regardless of which pane is up, so the empty-state
  // and the workspace both drive the same dialogs.
  const dialogs = (
    <>
      {showCreateNs && (
        <NamespaceCreateDialog onCreate={ws.createNamespace} onClose={() => setShowCreateNs(false)} />
      )}
      {showJoin && (
        <JoinModal
          onJoin={async (code) => { await ws.join(code); setShowJoin(false); }}
          onClose={() => setShowJoin(false)}
        />
      )}
      {showAddRepo && (
        <AddRepoDialog onAdd={ws.addRepo} onClose={() => setShowAddRepo(false)} />
      )}
    </>
  );

  // An SSO callback context is still resolving its namespace: hold off
  // (mirrors App.tsx's isLoading guard) rather than flash the picker right
  // before the desktop handoff lands.
  if (!ws.activeNs && ws.resolvingCallback) return null;

  // No active namespace (none yet, or a stale/invalid prior choice): never
  // silently enter one, and never fall through to the Shell either - that
  // flashed the repo UI over an empty workspace. Onboarding also offers a
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
      repoName={activeRepoName}
      repoUrl={ws.repoUrl}
      onNewIssue={openNewIssue}
      searchQuery={searchQuery}
      onSearchChange={setSearchQuery}
      searchInputRef={searchInputRef}
    >
      {ws.activeRepo ? (
        <Ready data-testid="workspace-ready">
          <Outlet context={ctx} />
        </Ready>
      ) : (
        <RepoGate>
          <div className="panel">
            <h2>No repository yet</h2>
            <p>Add a repository to this workspace to start tracking its issues.</p>
            <button className="primary" data-testid="repo-add-cta" onClick={() => setShowAddRepo(true)}>Add a repository</button>
          </div>
        </RepoGate>
      )}

      {aliasGate}
      {dialogs}
      {showNew && <NewIssueModal onCreate={createIssue} onClose={() => setShowNew(false)} />}
      {showInvite && <InviteModal onInvite={ws.invite} onClose={() => setShowInvite(false)} />}
    </Shell>
  );
}

// Fills the main column and carries the workspace-ready marker the e2e harness
// waits on.
const Ready = styled.div`
  display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0;
`;
const RepoGate = styled.div`
  flex: 1; display: flex; align-items: center; justify-content: center; padding: 24px;
  .panel {
    max-width: 400px; text-align: center; padding: 32px 28px;
    background: ${t.color.panel}; border: 1px solid ${t.color.border}; border-radius: 12px;
    h2 { font-size: 18px; font-weight: 600; letter-spacing: -0.02em; margin: 0 0 8px; }
    p { font-size: 13.5px; color: ${t.color.text2}; margin: 0 0 22px; line-height: 1.55; }
    .primary {
      background: ${t.color.accent}; color: ${t.color.onAccent}; border: 1px solid transparent;
      border-radius: ${t.radius}; font-size: 13px; font-weight: 600; padding: 10px 16px; cursor: pointer;
      &:hover { background: #b6ff5e; }
    }
  }
`;
