import { ContextApiDataSource } from './dataSource/nodeApiDataSource';
import { apiClient } from '@calimero-network/calimero-client';

export interface DefaultContextInfo {
  contextId: string;
  memberPublicKey: string;
  executorId: string;
  applicationId: string;
  context_name: string;
  is_private: boolean;
}

export class DefaultContextService {
  private static instance: DefaultContextService | null = null;
  private static globalCreatingFlag: boolean = false;
  private app: any;
  private nodeApiService: ContextApiDataSource;
  private isCreatingContext: boolean = false;

  private constructor(app: any) {
    this.app = app;
    this.nodeApiService = new ContextApiDataSource(app);
  }

  static getInstance(app: any): DefaultContextService {
    if (
      !DefaultContextService.instance ||
      DefaultContextService.instance.app !== app
    ) {
      DefaultContextService.instance = new DefaultContextService(app);
    }
    return DefaultContextService.instance;
  }

  static clearInstance(): void {
    DefaultContextService.globalCreatingFlag = false;
    DefaultContextService.instance = null;
  }

  /**
   * Check if a default context exists in localStorage
   */
  getStoredDefaultContext(): DefaultContextInfo | null {
    try {
      const stored = localStorage.getItem('defaultContext');
      return stored ? JSON.parse(stored) : null;
    } catch (error) {
      console.error('Error parsing stored default context:', error);
      return null;
    }
  }

  /**
   * Store default context info in localStorage
   */
  storeDefaultContext(contextInfo: DefaultContextInfo): void {
    try {
      localStorage.setItem('defaultContext', JSON.stringify(contextInfo));
      // Also store individual items for backward compatibility
      localStorage.setItem('defaultContextId', contextInfo.contextId);
      localStorage.setItem('defaultContextUserID', contextInfo.memberPublicKey);
    } catch (error) {
      console.error('Error storing default context:', error);
    }
  }

  /**
   * Check if a context is a default/private context using the backend API
   */
  async isDefaultPrivateContextViaApi(
    contextInfo: DefaultContextInfo,
  ): Promise<boolean> {
    try {
      if (this.app) {
        const result = await this.app.execute(
          contextInfo,
          'is_default_private_context',
          {},
        );

        const isDefaultPrivate = result?.data || result || false;
        return Boolean(isDefaultPrivate);
      }
    } catch (error) {
      console.warn(
        'App execute failed for is_default_private_context, falling back to API client:',
        error,
      );
    }

    try {
      const result = await apiClient.node().getContext(contextInfo.contextId);
      if (result.data) {
        const context = result.data as any;

        return (
          context.is_private === true &&
          (context.context_name === 'default' ||
            contextInfo.context_name === 'default')
        );
      }
      return false;
    } catch (error) {
      console.error('Error in isDefaultPrivateContextViaApi fallback:', error);
      return false;
    }
  }

  /**
   * Create a new default private context
   */
  async createDefaultContext(): Promise<{
    success: boolean;
    data?: any;
    error?: string;
  }> {
    try {
      if (this.app) {
        const initParams = {
          is_private: true,
          context_name: 'default',
        };

        const result = await this.app.createContext(undefined, initParams);
        return { success: true, data: result };
      }
    } catch (error) {
      console.warn(
        'App createContext failed, falling back to API service:',
        error,
      );
    }

    try {
      const createResponse = await this.nodeApiService.createContext({
        is_private: true,
        context_name: 'default',
      });

      if (createResponse.error) {
        console.error(
          'Failed to create default context:',
          createResponse.error,
        );
        return { success: false, error: createResponse.error.message };
      }

      return { success: true, data: createResponse.data };
    } catch (error: any) {
      console.error('Error creating default context:', error);
      return { success: false, error: error.message || 'Unknown error' };
    }
  }

  async ensureDefaultContext(): Promise<{
    success: boolean;
    contextInfo?: DefaultContextInfo;
    error?: string;
    wasCreated?: boolean;
  }> {
    if (DefaultContextService.globalCreatingFlag) {
      await new Promise((resolve) => setTimeout(resolve, 200));
      return this.ensureDefaultContext();
    }

    if (this.isCreatingContext) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      return this.ensureDefaultContext();
    }

    if (!this.app) {
      return { success: false, error: 'App not initialized' };
    }

    try {
      if (this.isCreatingContext) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        return this.ensureDefaultContext();
      }

      const storedContext = this.getStoredDefaultContext();

      if (storedContext) {
        const isStillValidDefault =
          await this.isDefaultPrivateContextViaApi(storedContext);
        if (isStillValidDefault) {
          return {
            success: true,
            contextInfo: storedContext,
            wasCreated: false,
          };
        } else {
          this.clearStoredDefaultContext();
        }
      }

      if (!storedContext && !DefaultContextService.globalCreatingFlag) {
        DefaultContextService.globalCreatingFlag = true;
        this.isCreatingContext = true;
      }

      let contexts;
      try {
        if (this.app && this.app.fetchContexts) {
          contexts = await this.app.fetchContexts();
        }
      } catch (error) {
        console.warn(
          'App fetchContexts failed, falling back to API client:',
          error,
        );
      }

      if (!contexts) {
        try {
          const result = await apiClient.node().getContexts();
          contexts = (result.data as unknown as any[]) || [];
        } catch (error) {
          console.error('Error fetching contexts via API client:', error);
          contexts = [];
        }
      }

      for (const context of contexts) {
        const contextInfo: DefaultContextInfo = {
          contextId: context.contextId,
          memberPublicKey: context.memberPublicKey || context.executorId,
          executorId: context.executorId,
          applicationId: context.applicationId,
          context_name: context.context_name || 'default',
          is_private: context.is_private || false,
        };

        const isDefaultPrivate =
          await this.isDefaultPrivateContextViaApi(contextInfo);

        if (isDefaultPrivate) {
          this.storeDefaultContext(contextInfo);

          if (DefaultContextService.globalCreatingFlag) {
            DefaultContextService.globalCreatingFlag = false;
            this.isCreatingContext = false;
          }

          return { success: true, contextInfo, wasCreated: false };
        }
      }

      if (!DefaultContextService.globalCreatingFlag) {
        await new Promise((resolve) => setTimeout(resolve, 200));
        return this.ensureDefaultContext();
      }

      const createResult = await this.createDefaultContext();

      if (!createResult.success) {
        console.error('Failed to create default context:', createResult.error);
        return { success: false, error: createResult.error };
      }

      const contextInfo: DefaultContextInfo = {
        contextId: createResult.data.contextId,
        memberPublicKey:
          createResult.data.memberPublicKey || createResult.data.executorId,
        executorId: createResult.data.executorId,
        applicationId: createResult.data.applicationId,
        context_name: 'default',
        is_private: true,
      };

      this.storeDefaultContext(contextInfo);

      return {
        success: true,
        contextInfo,
        wasCreated: true,
      };
    } catch (error: any) {
      DefaultContextService.globalCreatingFlag = false;
      this.isCreatingContext = false;
      console.error('Error ensuring default context:', error);
      return { success: false, error: error.message || 'Unknown error' };
    } finally {
      DefaultContextService.globalCreatingFlag = false;
      this.isCreatingContext = false;
    }
  }

  clearStoredDefaultContext(): void {
    try {
      localStorage.removeItem('defaultContext');
      localStorage.removeItem('defaultContextId');
      localStorage.removeItem('defaultContextUserID');
    } catch (error) {
      console.error('Error clearing stored default context:', error);
    }
  }
}
