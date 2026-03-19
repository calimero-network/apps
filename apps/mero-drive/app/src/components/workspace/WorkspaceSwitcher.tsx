import React, { useState, useEffect, useRef } from 'react';
import { useCalimero } from '@calimero-network/calimero-client';
import { WorkspaceManager, WorkspaceInfo } from '@/api/WorkspaceManager';
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
  const inputRef = useRef<HTMLInputElement>(null);

  const activeWorkspace = workspaces.find(w => w.id === activeGroupId);

  useEffect(() => {
    if (!app) return;
    loadWorkspaces();
  }, [app]);

  useEffect(() => {
    if (isCreating && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isCreating]);

  const loadWorkspaces = async () => {
    if (!app) return;
    setIsLoading(true);
    try {
      const manager = new WorkspaceManager(app);
      const list = await manager.listWorkspaces();
      setWorkspaces(list);

      // Auto-select first workspace if none active
      if (!activeGroupId && list.length > 0 && list[0].generalContextId) {
        setActiveWorkspace(list[0].id, list[0].generalContextId);
      }
    } catch (err) {
      console.error('[WorkspaceSwitcher] Failed to load workspaces:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSelectWorkspace = (workspace: WorkspaceInfo) => {
    if (!workspace.generalContextId) return;
    setActiveWorkspace(workspace.id, workspace.generalContextId);
  };

  const handleCreateWorkspace = async () => {
    const name = newWorkspaceName.trim();
    if (!name || !app) return;

    setIsSubmitting(true);
    try {
      const manager = new WorkspaceManager(app);
      const groupId = await manager.createWorkspace(name);
      setIsCreating(false);
      setNewWorkspaceName('');
      await loadWorkspaces();

      // Select the newly created workspace
      const updated = await manager.listWorkspaces();
      const created = updated.find(w => w.id === groupId);
      if (created?.generalContextId) {
        setActiveWorkspace(created.id, created.generalContextId);
      }
    } catch (err) {
      console.error('[WorkspaceSwitcher] Failed to create workspace:', err);
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
            onClick={() => setIsCreating(true)}
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
    </div>
  );
};
