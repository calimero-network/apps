import { CalimeroApp } from '@calimero-network/calimero-client';
import { AbiClient, FolderRegistryEntry } from './AbiClient';
import {
  adminRequest,
  createContextForGroup,
  DEFAULT_CONTEXT_PROTOCOL,
  encodeInitializationParams,
} from './AdminApi';
import { getApplicationId } from '@/constants/config';

export type { FolderRegistryEntry };

export type ContextVisibility = 'open' | 'restricted';

export interface FolderContextWithVisibility extends FolderRegistryEntry {
  visibility: ContextVisibility;
}

export class FolderContextManager {
  constructor(private app: CalimeroApp) {}

  async listFolderContexts(generalContextId: string): Promise<FolderRegistryEntry[]> {
    return new AbiClient(this.app, generalContextId).getFolderRegistry();
  }

  async listGroupFolderContexts(
    groupId: string,
    generalContextId?: string,
  ): Promise<FolderRegistryEntry[]> {
    const groupContexts = await adminRequest<Array<{ contextId: string; alias?: string | null }>>(
      `/groups/${groupId}/contexts`,
    );

    let registryByContextId = new Map<string, FolderRegistryEntry>();
    if (generalContextId) {
      try {
        const registryEntries = await this.listFolderContexts(generalContextId);
        registryByContextId = new Map(
          registryEntries.map((entry) => [entry.context_id, entry]),
        );
      } catch (err) {
        // Non-blocking fallback: UI can still show group contexts without registry metadata.
        console.warn('[FolderContextManager] Failed to load folder registry:', err);
      }
    }

    return groupContexts
      .filter((ctx) => !generalContextId || ctx.contextId !== generalContextId)
      .map((ctx) => {
        const registryEntry = registryByContextId.get(ctx.contextId);
        if (registryEntry) {
          return registryEntry;
        }
        return {
          context_id: ctx.contextId,
          name: ctx.alias ?? 'Unnamed',
          color: null,
          created_at: 0,
        };
      });
  }

  /**
   * Returns the group folder-contexts enriched with per-context visibility.
   * Visibility is fetched in parallel; failures default to `'open'`.
   */
  async listGroupFolderContextsWithVisibility(
    groupId: string,
    generalContextId?: string,
  ): Promise<FolderContextWithVisibility[]> {
    const folders = await this.listGroupFolderContexts(groupId, generalContextId);

    const enriched = await Promise.all(
      folders.map(async (folder) => {
        let visibility: ContextVisibility = 'open';
        try {
          visibility = await this.getFolderVisibility(groupId, folder.context_id);
        } catch {
          // Non-blocking: default to open when the node doesn't support visibility
        }
        return { ...folder, visibility };
      }),
    );

    return enriched;
  }

  async createFolderContext(
    groupId: string,
    generalContextId: string,
    name: string,
    color?: string,
  ): Promise<string> {
    const context = await createContextForGroup(groupId, {
      applicationId: getApplicationId(),
      protocol: DEFAULT_CONTEXT_PROTOCOL,
      alias: name,
      initializationParams: encodeInitializationParams({}),
    });
    const contextId = context.contextId;

    // Set context name — best-effort, non-blocking
    try {
      await new AbiClient(this.app, contextId).setContextName({ name });
    } catch (err) {
      console.warn('[FolderContextManager] setContextName failed (non-blocking):', err);
    }

    // Register in the General context registry. On failure, detach the
    // freshly-created context from the group so a retry doesn't accumulate
    // orphaned contexts that the registry never learns about.
    try {
      await new AbiClient(this.app, generalContextId).registerFolder({
        context_id: contextId,
        name,
        color: color ?? null,
      });
    } catch (err) {
      try {
        await adminRequest<void>(`/groups/${groupId}/contexts/${contextId}/remove`, {
          method: 'POST',
          body: {},
        });
      } catch (cleanupErr) {
        console.warn('[FolderContextManager] Failed to detach orphan context after registerFolder error:', cleanupErr);
      }
      throw err;
    }

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
    await adminRequest<void>(`/groups/${groupId}/contexts/${contextId}/remove`, {
      method: 'POST',
      body: {},
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
    await adminRequest<void>(`/groups/${groupId}/contexts/${contextId}/visibility`, {
      method: 'PUT',
      body: { mode },
    });
  }

  async getFolderVisibility(
    groupId: string,
    contextId: string,
  ): Promise<'open' | 'restricted'> {
    const visibility = await adminRequest<{ mode: 'open' | 'restricted' }>(
      `/groups/${groupId}/contexts/${contextId}/visibility`,
    );
    return visibility.mode;
  }

  /** Returns the list of member identities allowed to access a restricted context. */
  async getContextAllowlist(
    groupId: string,
    contextId: string,
  ): Promise<string[]> {
    const data = await adminRequest<string[]>(
      `/groups/${groupId}/contexts/${contextId}/allowlist`,
    );
    return Array.isArray(data) ? data : [];
  }

  /**
   * Manages the allowlist for a restricted context by adding and/or removing
   * identities in a single request.
   */
  async manageContextAllowlist(
    groupId: string,
    contextId: string,
    changes: { add?: string[]; remove?: string[] },
  ): Promise<void> {
    await adminRequest<void>(
      `/groups/${groupId}/contexts/${contextId}/allowlist`,
      {
        method: 'POST',
        body: changes,
      },
    );
  }

  /** Adds a single identity to the allowlist of a restricted context. */
  async addToContextAllowlist(
    groupId: string,
    contextId: string,
    identity: string,
  ): Promise<void> {
    await this.manageContextAllowlist(groupId, contextId, { add: [identity] });
  }

  /** Removes a single identity from the allowlist of a restricted context. */
  async removeFromContextAllowlist(
    groupId: string,
    contextId: string,
    identity: string,
  ): Promise<void> {
    await this.manageContextAllowlist(groupId, contextId, { remove: [identity] });
  }
}
