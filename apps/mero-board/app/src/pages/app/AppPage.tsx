import React, { useCallback, useMemo, useState } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import styled from 'styled-components';
import { useMero } from '@calimero-network/mero-react';
import { shouldRetain } from '@calimero-apps/invite';
import { tokens as t } from '../../theme';
import { useWorkspace } from '../../hooks/useWorkspace';
import { makeAliases } from '../../hooks/useAliases';
import Shell from '../../components/Shell';
import InviteModal from '../../components/InviteModal';
import JoinModal from '../../components/JoinModal';
import NamespaceCreateDialog from '../../components/NamespaceCreateDialog';
import AddFolderDialog from '../../components/AddFolderDialog';
import NsEmptyState from '../../components/NsEmptyState';
import AliasGate from '../../components/AliasGate';
import { usePendingInvitation } from '../../hooks/usePendingInvitation';
import { APP_ROUTE } from '../../config';
import type { AppCtx } from './appContext';

/**
 * Board root: owns workspace resolution (namespace + folder) and every modal.
 * Onboarding is explicit: no active namespace -> full-pane empty state (with a
 * picker if namespaces exist); a namespace with no folder -> add-folder
 * prompt; a member with no name -> blocking alias gate.
 */
export default function AppPage(): React.ReactElement | null {
  const { contextIdentity } = useMero();
  const ws = useWorkspace();

  // Two different ids, and they are NOT interchangeable since core rc.21.
  //
  // `currentUser` is who authorship is attributed to: the contract reports
  // created_by/author as the ACCOUNT on the entry's owner stamp (one person,
  // any device) and every node enforces edit/delete against it, so every
  // "is this mine" gate must compare against the account, never the executor key.
  const currentUser = ws.selfIdentity ?? contextIdentity ?? '';
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

  const [showInvite, setShowInvite] = useState(false);
  const [showJoin, setShowJoin] = useState(false);
  const [showCreateNs, setShowCreateNs] = useState(false);
  const [showAddFolder, setShowAddFolder] = useState(false);

  const openInvite = useCallback(() => setShowInvite(true), []);

  // A board id belongs to one folder's context, so changing the folder from a
  // board (or card) route must leave that route: otherwise the board page goes
  // on asking the new folder for a board it does not hold.
  const navigate = useNavigate();
  const { selectFolder: wsSelectFolder, addFolder: wsAddFolder } = ws;
  const selectFolder = useCallback((contextId: string) => {
    wsSelectFolder(contextId);
    navigate(APP_ROUTE);
  }, [wsSelectFolder, navigate]);
  const addFolder = useCallback(async (name: string) => {
    const id = await wsAddFolder(name);
    if (id) navigate(APP_ROUTE);
    return id;
  }, [wsAddFolder, navigate]);

  const membersCount = Math.max(ws.members.length, 1);
  const activeFolderName = ws.folders.find((r) => r.contextId === ws.activeFolder)?.name ?? null;

  const ctx: AppCtx = { currentUser, members: ws.members, aliases, openInvite, ws };

  const sidebar = {
    membersCount,
    currentUser,
    currentUserLabel: selfMember ? aliases.resolve(selfMember) : '',
    currentUserHasAlias: selfMember ? aliases.hasAlias(selfMember) : false,
    namespaces: ws.namespaces,
    activeNs: ws.activeNs,
    onSelectNamespace: ws.selectNamespace,
    onNewNamespace: () => setShowCreateNs(true),
    onJoinNamespace: () => setShowJoin(true),
    folders: ws.folders,
    foldersSyncing: ws.isSyncing,
    onDismissFoldersSyncing: ws.dismissSyncing,
    activeFolder: ws.activeFolder,
    onSelectFolder: selectFolder,
    onAddFolder: () => setShowAddFolder(true),
    canAddFolder: ws.roles.canAddFolder,
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
      {showAddFolder && (
        <AddFolderDialog onAdd={addFolder} onClose={() => setShowAddFolder(false)} />
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
  // flashed the folder UI over an empty workspace. Onboarding also offers a
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
    <Shell sidebar={sidebar} folderName={activeFolderName}>
      {ws.activeFolder ? (
        <Ready data-testid="workspace-ready">
          <Outlet context={ctx} />
        </Ready>
      ) : (
        <FolderGate>
          <div className="panel">
            <h2>No folder yet</h2>
            <p>Add a folder to this workspace to start a board.</p>
            {ws.roles.canAddFolder ? (
              <button className="primary" data-testid="folder-add-cta" onClick={() => setShowAddFolder(true)}>Add a folder</button>
            ) : (
              // Honest dead end rather than a button that 403s: the person
              // cannot fix this themselves, so say who can.
              <p className="gated" data-testid="folder-add-denied">
                Ask a workspace admin to add one, or to give you permission to add
                folders.
              </p>
            )}
          </div>
        </FolderGate>
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
const FolderGate = styled.div`
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
