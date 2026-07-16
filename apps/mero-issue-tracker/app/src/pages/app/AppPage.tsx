import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Outlet, useSearchParams } from 'react-router-dom';
import styled from 'styled-components';
import { useMero } from '@calimero-network/mero-react';
import { useToast } from '@calimero-network/mero-ui';
import { tokens as t } from '../../theme';
import { APP_DISPLAY_NAME } from '../../config';
import { useWorkspace } from '../../hooks/useWorkspace';
import { useIssues } from '../../hooks/useItems';
import { useAliases } from '../../hooks/useAliases';
import { describeError } from '../../utils/errors';
import Shell from '../../components/Shell';
import NewIssueModal from '../../components/NewIssueModal';
import InviteModal from '../../components/InviteModal';
import JoinModal from '../../components/JoinModal';
import type { AppCtx, Filters } from './appContext';

const EMPTY_FILTERS: Filters = { status: '', priority: '', assignee: '', label: '' };

/**
 * Tracker root: resolves the shared workspace, owns the issue data hook, filter
 * state, the New-issue / Invite / Join modals, and the `C`/`Esc` shortcuts. When
 * a workspace exists it renders the Shell and hands everything to the routed
 * views via <Outlet context>. Otherwise it shows the create-or-join gate.
 */
export default function AppPage(): React.ReactElement {
  const { mero, logout, contextIdentity } = useMero();
  const ws = useWorkspace();
  const toast = useToast();
  const [searchParams] = useSearchParams();

  const currentUser = ws.executorPublicKey ?? contextIdentity ?? '';
  const myIssues = searchParams.get('assignee') === 'me';
  const aliases = useAliases(ws.contextId);

  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const setFilter = useCallback((patch: Partial<Filters>) => {
    setFilters((f) => ({ ...f, ...patch }));
  }, []);
  const clearFilters = useCallback(() => setFilters(EMPTY_FILTERS), []);

  // list_issues filters (server-side): status/assignee/label. `?assignee=me`
  // narrows to the current identity, but assignments store the display string
  // (alias) the assignee picker writes, not the raw key - resolve it the same
  // way to match.
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

  // Context members (public keys) power the Members view + peer count. Read-only
  // enrichment; the issue data layer is untouched.
  const [members, setMembers] = useState<string[]>([]);
  useEffect(() => {
    if (!mero || !ws.contextId) { setMembers([]); return; }
    let cancelled = false;
    (async () => {
      try {
        const { identities } = await mero.admin.getContextIdentities(ws.contextId!);
        if (!cancelled) setMembers(identities);
      } catch { /* leave empty; falls back to just the current identity */ }
    })();
    return () => { cancelled = true; };
  }, [mero, ws.contextId]);

  const [showNew, setShowNew] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [showJoin, setShowJoin] = useState(false);

  const openNewIssue = useCallback(() => setShowNew(true), []);
  const openInvite = useCallback(() => setShowInvite(true), []);

  // `C` opens New issue; `Esc` closes an open modal. Ignore `C` while typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const anyModal = showNew || showInvite || showJoin;
      if (e.key === 'Escape' && showNew) { setShowNew(false); return; }
      if ((e.key === 'c' || e.key === 'C') && !anyModal) {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') {
          e.preventDefault();
          setShowNew(true);
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [showNew, showInvite, showJoin]);

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

  const ctx: AppCtx = {
    data, currentUser, members, aliases, filters, myIssues,
    setFilter, clearFilters, openNewIssue, openInvite, ws,
  };

  // No workspace yet (fresh web session): create-or-join gate.
  if (!ws.ready && !ws.loading) {
    return (
      <Gate>
        <Card>
          <h2>Welcome to {APP_DISPLAY_NAME}</h2>
          <p>Create a shared board to start triaging issues, or join one you were invited to.</p>
          <div className="row">
            <button className="primary" data-testid="create-workspace-btn" onClick={() => ws.bootstrap()}>Create board</button>
            <button className="secondary" data-testid="open-join-btn" onClick={() => setShowJoin(true)}>Join with invitation</button>
          </div>
          {ws.error && <p className="err">{describeError(ws.error)}</p>}
        </Card>
        {showJoin && (
          <JoinModal
            onJoin={async (code) => { await ws.join(code); setShowJoin(false); }}
            onClose={() => setShowJoin(false)}
          />
        )}
      </Gate>
    );
  }

  const totalIssues = Object.values(data.counts).reduce((a, b) => a + b, 0);
  const membersCount = Math.max(members.length, 1);

  return (
    <Shell
      totalIssues={totalIssues}
      membersCount={membersCount}
      currentUser={currentUser}
      currentUserLabel={currentUser ? aliases.resolve(currentUser) : ''}
      onNewIssue={openNewIssue}
    >
      <Ready data-testid="workspace-ready">
        <Outlet context={ctx} />
      </Ready>

      {showNew && <NewIssueModal onCreate={createIssue} onClose={() => setShowNew(false)} />}
      {showInvite && <InviteModal onInvite={ws.invite} onClose={() => setShowInvite(false)} />}
      {showJoin && (
        <JoinModal
          onJoin={async (code) => { await ws.join(code); setShowJoin(false); }}
          onClose={() => setShowJoin(false)}
        />
      )}
    </Shell>
  );
}

// Fills the main column and carries the workspace-ready marker the e2e harness
// waits on. `display: contents` keeps the Shell's fl-column layout intact.
const Ready = styled.div`
  display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0;
`;
const Gate = styled.div`
  flex: 1; min-height: 100vh; display: flex; align-items: center; justify-content: center;
  padding: 24px; background: ${t.color.bg}; color: ${t.color.text};
  font-family: ${t.font.sans};
`;
const Card = styled.div`
  max-width: 420px; text-align: center;
  padding: 32px 28px; background: ${t.color.panel};
  border: 1px solid ${t.color.border}; border-radius: 12px;
  h2 { font-size: 20px; font-weight: 600; letter-spacing: -0.02em; margin-bottom: 8px; }
  p { font-size: 13.5px; color: ${t.color.text2}; margin-bottom: 22px; line-height: 1.55; }
  .row { display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; }
  button { border-radius: ${t.radius}; font-size: 13px; font-weight: 600; padding: 10px 16px; cursor: pointer; }
  .primary { background: ${t.color.accent}; color: ${t.color.onAccent}; border: 1px solid transparent; &:hover { background: #b6ff5e; } }
  .secondary { background: ${t.color.raised}; color: ${t.color.text}; border: 1px solid ${t.color.border}; &:hover { background: ${t.color.raised2}; } }
  .err { color: ${t.color.urgent}; margin-top: 12px; }
`;
