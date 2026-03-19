import { CalimeroApp } from '@calimero-network/calimero-client';
import { AbiClient } from './AbiClient';

export interface WorkspaceInfo {
  id: string;
  name: string;
  generalContextId: string;
}

export interface MemberInfo {
  identity: string;
  capabilities: string[];
}

export class WorkspaceManager {
  constructor(private app: CalimeroApp) {}

  async listWorkspaces(): Promise<WorkspaceInfo[]> {
    const response = await fetch('/admin-api/groups');
    if (!response.ok) {
      throw new Error(`Failed to list workspaces: ${response.statusText}`);
    }
    const data = await response.json();
    const groups: Array<{ id: string; alias?: string | null }> = Array.isArray(data) ? data : (data.groups ?? []);

    const workspaces = await Promise.all(
      groups.map(async (group) => {
        let generalContextId = '';
        try {
          const ctxRes = await fetch(`/admin-api/groups/${group.id}/contexts`);
          if (ctxRes.ok) {
            const ctxData = await ctxRes.json();
            const contexts: Array<{ id: string }> = Array.isArray(ctxData) ? ctxData : (ctxData.contexts ?? []);
            if (contexts.length > 0) {
              generalContextId = contexts[0].id;
            }
          }
        } catch {
          // non-blocking: leave generalContextId empty
        }
        return {
          id: group.id,
          name: group.alias ?? 'Unnamed',
          generalContextId,
        };
      }),
    );

    return workspaces;
  }

  async createWorkspace(name: string): Promise<string> {
    // Create the group
    const createRes = await fetch('/admin-api/groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    if (!createRes.ok) {
      throw new Error(`Failed to create workspace: ${createRes.statusText}`);
    }
    const createData = await createRes.json();
    const groupId: string = createData.id ?? createData.groupId ?? createData;

    // Set the alias
    await fetch(`/admin-api/groups/${groupId}/alias`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ alias: name }),
    });

    // Create the General context within the group
    let generalContextId = '';
    try {
      const ctxRes = await fetch(`/admin-api/groups/${groupId}/contexts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (ctxRes.ok) {
        const ctxData = await ctxRes.json();
        generalContextId = ctxData.id ?? ctxData.contextId ?? ctxData;
      }
    } catch (err) {
      console.warn('[WorkspaceManager] Failed to create General context via admin API, falling back to app.createContext()', err);
      try {
        const ctx = await this.app.createContext();
        generalContextId = ctx.contextId;
      } catch (e2) {
        console.error('[WorkspaceManager] Fallback context creation also failed:', e2);
      }
    }

    // Set context name — non-blocking
    if (generalContextId) {
      try {
        await new AbiClient(this.app, generalContextId).setContextName({ name: 'General' });
      } catch (err) {
        console.warn('[WorkspaceManager] setContextName failed (non-blocking):', err);
      }
    }

    return groupId;
  }

  async setWorkspaceName(groupId: string, name: string): Promise<void> {
    const response = await fetch(`/admin-api/groups/${groupId}/alias`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ alias: name }),
    });
    if (!response.ok) {
      throw new Error(`Failed to set workspace name: ${response.statusText}`);
    }
  }

  async getWorkspaceMembers(groupId: string): Promise<MemberInfo[]> {
    const response = await fetch(`/admin-api/groups/${groupId}/members`);
    if (!response.ok) {
      throw new Error(`Failed to get workspace members: ${response.statusText}`);
    }
    const data = await response.json();
    const members: Array<{ identity: string; capabilities?: string[] }> = Array.isArray(data)
      ? data
      : (data.members ?? []);
    return members.map((m) => ({
      identity: m.identity,
      capabilities: m.capabilities ?? [],
    }));
  }
}
