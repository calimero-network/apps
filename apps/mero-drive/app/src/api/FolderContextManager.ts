import { CalimeroApp } from '@calimero-network/calimero-client';
import { AbiClient, FolderRegistryEntry } from './AbiClient';

export type { FolderRegistryEntry };

export class FolderContextManager {
  constructor(private app: CalimeroApp) {}

  async listFolderContexts(generalContextId: string): Promise<FolderRegistryEntry[]> {
    return new AbiClient(this.app, generalContextId).getFolderRegistry();
  }

  async createFolderContext(
    groupId: string,
    generalContextId: string,
    name: string,
    color?: string,
  ): Promise<string> {
    // Create context within the group via admin API
    const ctxRes = await fetch(`/admin-api/groups/${groupId}/contexts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    if (!ctxRes.ok) {
      throw new Error(`Failed to create folder context: ${ctxRes.statusText}`);
    }
    const ctxData = await ctxRes.json();
    const contextId: string = ctxData.id ?? ctxData.contextId ?? ctxData;

    // Set context name — best-effort, non-blocking
    try {
      await new AbiClient(this.app, contextId).setContextName({ name });
    } catch (err) {
      console.warn('[FolderContextManager] setContextName failed (non-blocking):', err);
    }

    // Register in the General context registry
    await new AbiClient(this.app, generalContextId).registerFolder({
      context_id: contextId,
      name,
      color: color ?? null,
    });

    return contextId;
  }

  async renameFolderContext(
    generalContextId: string,
    contextId: string,
    name: string,
  ): Promise<void> {
    // Update the General registry first
    await new AbiClient(this.app, generalContextId).updateFolderName({
      context_id: contextId,
      name,
    });

    // Update the folder's own context name — best-effort
    try {
      await new AbiClient(this.app, contextId).setContextName({ name });
    } catch (err) {
      console.warn('[FolderContextManager] setContextName failed (non-blocking):', err);
    }
  }

  async deleteFolderContext(
    groupId: string,
    generalContextId: string,
    contextId: string,
  ): Promise<void> {
    // Remove from General registry
    await new AbiClient(this.app, generalContextId).unregisterFolder({ context_id: contextId });

    // Detach context from group
    await fetch(`/admin-api/groups/${groupId}/contexts/${contextId}/remove`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
  }

  async getFolderDocumentCount(contextId: string): Promise<number> {
    return new AbiClient(this.app, contextId).getDocumentCount();
  }

  async setFolderVisibility(
    groupId: string,
    contextId: string,
    mode: 'open' | 'restricted',
  ): Promise<void> {
    const response = await fetch(`/admin-api/groups/${groupId}/contexts/${contextId}/visibility`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode }),
    });
    if (!response.ok) {
      throw new Error(`Failed to set folder visibility: ${response.statusText}`);
    }
  }
}
