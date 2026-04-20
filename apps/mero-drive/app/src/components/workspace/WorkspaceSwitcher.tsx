import React, { useState, useEffect, useRef } from 'react';
import { useCalimero } from '@calimero-network/calimero-client';
import { WorkspaceManager, WorkspaceInfo } from '@/api/WorkspaceManager';
import { adminRequest, AdminApiError } from '@/api/AdminApi';
import { getGroupMemberIdentity, setGroupMemberIdentity } from '@/constants/config';
import { useWorkspace } from '@/context/WorkspaceContext';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Check, ChevronDown, Plus, Users } from 'lucide-react';

export const WorkspaceSwitcher: React.FC = () => {
  const { app } = useCalimero();
  const { activeGroupId, setActiveWorkspace } = useWorkspace();

  const [workspaces, setWorkspaces] = useState<WorkspaceInfo[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [newWorkspaceName, setNewWorkspaceName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const activeWorkspace = workspaces.find(w => w.id === activeGroupId);

  useEffect(() => {
    if (isCreating && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isCreating]);

  // Read activeGroupId via a ref so the load effect doesn't re-fire when
  // auto-select updates it (which would otherwise cause a redundant refetch).
  const activeGroupIdRef = useRef(activeGroupId);
  useEffect(() => {
    activeGroupIdRef.current = activeGroupId;
  }, [activeGroupId]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setIsLoading(true);
      setErrorMessage(null);
      try {
        const manager = new WorkspaceManager(app);
        const currentActiveGroupId = activeGroupIdRef.current;
        const list = await manager.listWorkspaces(currentActiveGroupId);
        if (cancelled) return;
        setWorkspaces(list);

        if (list.length === 0) {
          if (currentActiveGroupId) {
            setActiveWorkspace(null, null);
          }
          return;
        }

        const activeWorkspaceExists = currentActiveGroupId
          ? list.some((workspace) => workspace.id === currentActiveGroupId)
          : false;

        // Auto-select the first available workspace when there is no active selection
        // or when persisted state points at a workspace that no longer exists.
        if ((!currentActiveGroupId || !activeWorkspaceExists) && list[0].generalContextId) {
          const first = list[0];
          try {
            const joined = await manager.isMemberOfContext(first.id, first.generalContextId);
            if (!joined) {
              await manager.joinContextViaGroup(first.id, first.generalContextId);
            }
          } catch {
            // proceed with workspace selection
          }
          if (!cancelled) {
            setActiveWorkspace(first.id, first.generalContextId);
          }
        }
      } catch (err) {
        if (cancelled) return;
        console.error('[WorkspaceSwitcher] Failed to load workspaces:', err);
        setErrorMessage('Failed to load workspaces from the current Calimero node.');
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [app, setActiveWorkspace]);

  const handleSelectWorkspace = async (workspace: WorkspaceInfo) => {
    setErrorMessage(null);

    try {
      const manager = new WorkspaceManager(app);
      const generalContextId =
        workspace.generalContextId || await manager.resolveGeneralContextId(workspace.id);

      if (!generalContextId) {
        setErrorMessage('This workspace does not have a General context yet.');
        return;
      }

      try {
        const joined = await manager.isMemberOfContext(workspace.id, generalContextId);
        if (!joined) {
          await manager.joinContextViaGroup(workspace.id, generalContextId);
        }
      } catch {
        // proceed with selection
      }

      setWorkspaces((current) => current.map((entry) => (
        entry.id === workspace.id
          ? { ...entry, generalContextId }
          : entry
      )));
      setActiveWorkspace(workspace.id, generalContextId);

      // Pre-cache identity for instant permission resolution
      if (!getGroupMemberIdentity(workspace.id) && generalContextId) {
        try {
          const data = await adminRequest<{ identities: string[] }>(
            `/contexts/${generalContextId}/identities-owned`,
          );
          const { members } = await manager.getWorkspaceMembers(workspace.id);
          const match = (data.identities ?? []).find((id) =>
            members.some((m) => m.identity === id),
          );
          if (match) {
            setGroupMemberIdentity(workspace.id, match);
          }
        } catch {
          // Non-blocking — permissions hook will resolve it later
        }
      }
    } catch (err) {
      console.error('[WorkspaceSwitcher] Failed to select workspace:', err);
      setErrorMessage(
        `Failed to load the selected workspace context: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };

  const handleCreateWorkspace = async () => {
    const name = newWorkspaceName.trim();
    if (!name) return;

    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      const manager = new WorkspaceManager(app);
      const workspace = await manager.createWorkspace(name);
      setIsCreating(false);
      setNewWorkspaceName('');
      setWorkspaces((current) => {
        const filtered = current.filter((entry) => entry.id !== workspace.id);
        return [...filtered, workspace];
      });
      setActiveWorkspace(workspace.id, workspace.generalContextId);

      // Store creator identity so permissions resolve instantly on first load
      if (workspace.generalContextId) {
        try {
          const data = await adminRequest<{ identities: string[] }>(
            `/contexts/${workspace.generalContextId}/identities-owned`,
          );
          const owned = data.identities?.[0];
          if (owned) {
            setGroupMemberIdentity(workspace.id, owned);
          }
        } catch {
          // Non-blocking — permissions hook will resolve it later
        }
      }

      try {
        const refreshed = await manager.listWorkspaces(workspace.id);
        setWorkspaces(refreshed);
      } catch (refreshError) {
        console.warn('[WorkspaceSwitcher] Workspace created, but refresh failed:', refreshError);
      }
    } catch (err) {
      console.error('[WorkspaceSwitcher] Failed to create workspace:', err);
      if (err instanceof AdminApiError) {
        if (err.kind === 'transport') {
          setErrorMessage(
            'Could not reach the Calimero node admin API. Check the node endpoint and admin setup.',
          );
        } else if (err.kind === 'auth') {
          setErrorMessage('The Calimero node rejected this request. Sign in again and retry.');
        } else if (err.kind === 'validation') {
          setErrorMessage(`Workspace creation was rejected by the node: ${err.message}`);
        } else {
          setErrorMessage(
            `Workspace creation may be partially complete on the node: ${err.message}`,
          );
        }
      } else {
        setErrorMessage(
          `Workspace creation failed unexpectedly: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="w-full justify-between h-8 px-2 text-sm font-medium">
            <span className="truncate">
              {isLoading ? 'Loading...' : (activeWorkspace?.name ?? 'Select Workspace')}
            </span>
            <ChevronDown className="w-3.5 h-3.5 ml-1 flex-shrink-0 text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          {workspaces.map((ws) => (
            <DropdownMenuItem
              key={ws.id}
              onClick={() => handleSelectWorkspace(ws)}
              className="flex items-center gap-2"
            >
              {ws.id === activeGroupId ? (
                <Check className="w-4 h-4 text-primary flex-shrink-0" />
              ) : (
                <span className="w-4 h-4 flex-shrink-0" />
              )}
              <span className="truncate">{ws.name}</span>
            </DropdownMenuItem>
          ))}
          {workspaces.length > 0 && <DropdownMenuSeparator />}
          <DropdownMenuItem
            onClick={() => setTimeout(() => setIsCreating(true), 0)}
            className="flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            Create Workspace
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => window.location.assign('/join')}
            className="flex items-center gap-2"
          >
            <Users className="w-4 h-4" />
            Join Workspace
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {isCreating && (
        <div className="flex gap-1.5">
          <input
            ref={inputRef}
            type="text"
            value={newWorkspaceName}
            onChange={(e) => setNewWorkspaceName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreateWorkspace();
              if (e.key === 'Escape') {
                setIsCreating(false);
                setNewWorkspaceName('');
              }
            }}
            placeholder="Workspace name"
            className="flex-1 px-2 py-1 text-xs bg-muted border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary/40"
            disabled={isSubmitting}
          />
          <Button
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={handleCreateWorkspace}
            disabled={!newWorkspaceName.trim() || isSubmitting}
          >
            {isSubmitting ? '...' : 'Create'}
          </Button>
        </div>
      )}

      {errorMessage && (
        <p className="text-xs text-destructive px-1">{errorMessage}</p>
      )}
    </div>
  );
};
