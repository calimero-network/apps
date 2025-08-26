import type {
  CreateContextProps,
  CreateContextResponse,
  InviteToContextProps,
  JoinContextProps,
  JoinContextResponse,
  NodeApi,
  VerifyContextProps,
  VerifyContextResponse,
} from '../nodeApi';
import { apiClient } from '@calimero-network/calimero-client';
import { backendService } from '../icp/backendService';

export class ContextApiDataSource implements NodeApi {
  private app: any;

  constructor(app: any) {
    this.app = app;
  }

  async createContext(
    props: CreateContextProps,
  ): Promise<{ data?: CreateContextResponse; error?: any }> {
    try {
      if (this.app) {
        const initParams = {
          is_private: props.is_private,
          context_name: props.context_name,
        };

        const result = await this.app.createContext(undefined, initParams);

        try {
          const icp = await backendService();
          const created = result as any;
          const contextId =
            created?.contextId || created?.context_id || props.context_name;
          if (contextId) {
            const icpRequest = {
              context_id: contextId,
              participants: (props as any).participants || [],
              title: props.context_name ? [props.context_name] : [],
              description: (props as any).description
                ? [(props as any).description]
                : [],
              agreement_type: (props as any).agreement_type
                ? [(props as any).agreement_type]
                : [],
              expires_at:
                (props as any).expires_at != null
                  ? [BigInt((props as any).expires_at)]
                  : [],
            } as any;
            try {
              await icp.createContext(icpRequest);
            } catch (icpErr) {
              console.warn('ICP: createContext failed (non-fatal):', icpErr);
            }
          }
        } catch (err) {
          console.warn('ICP backendService unavailable (non-fatal):', err);
        }

        return { data: result, error: null };
      }
    } catch (error) {
      console.warn('App createContext failed, falling back to API:', error);
    }

    try {
      const applicationId = import.meta.env.VITE_APPLICATION_ID;
      if (!applicationId) {
        throw new Error(
          'Application ID not available in environment variables',
        );
      }
      const result = await apiClient
        .node()
        .createContext(applicationId, JSON.stringify(props), 'near');

      try {
        const icp = await backendService();
        const created = result.data as any;

        const contextId =
          created?.contextId || created?.context_id || props.context_name;
        if (contextId) {
          const icpRequest = {
            context_id: contextId,
            participants: (props as any).participants || [],
            // Candid Opt<T> must be encoded as [] (none) or [value] (some)
            title: props.context_name ? [props.context_name] : [],
            description: (props as any).description
              ? [(props as any).description]
              : [],
            agreement_type: (props as any).agreement_type
              ? [(props as any).agreement_type]
              : [],
            expires_at:
              (props as any).expires_at != null
                ? [BigInt((props as any).expires_at)]
                : [],
          } as any;
          try {
            await icp.createContext(icpRequest);
          } catch (icpErr) {
            console.warn('ICP: createContext failed (non-fatal):', icpErr);
          }
        }
      } catch (err) {
        console.warn('ICP backendService unavailable (non-fatal):', err);
      }

      return { data: result.data as CreateContextResponse, error: null };
    } catch (error) {
      let errorMessage = 'An unexpected error occurred during createContext';
      if (error instanceof Error) {
        errorMessage = error.message;
      }
      return {
        data: undefined,
        error: {
          code: 500,
          message: errorMessage,
        },
      };
    }
  }

  async inviteToContext(
    props: InviteToContextProps,
  ): Promise<{ data?: string; error?: any }> {
    try {
      if (this.app) {
        const result = await this.app.inviteToContext({
          contextId: props.contextId,
          inviterId: props.inviter,
          inviteeId: props.invitee,
        });
        return { data: result, error: null };
      }
    } catch (error) {
      console.warn('App inviteToContext failed, falling back to API:', error);
    }

    try {
      const result = await apiClient
        .node()
        .contextInvite(props.contextId, props.inviter, props.invitee);
      return { data: result.data || undefined, error: null };
    } catch (error) {
      console.error('inviteToContext failed:', error);
      let errorMessage = 'An unexpected error occurred during inviteToContext';
      if (error instanceof Error) {
        errorMessage = error.message;
      }
      return {
        data: undefined,
        error: {
          code: 500,
          message: errorMessage,
        },
      };
    }
  }

  async joinContext(
    props: JoinContextProps,
  ): Promise<{ data?: JoinContextResponse; error?: any }> {
    try {
      if (this.app) {
        const result = await this.app.joinContext({
          invitationPayload: props.invitationPayload,
        });
        return { data: result, error: null };
      }
    } catch (error) {
      console.warn('App joinContext failed, falling back to API:', error);
    }

    try {
      const result = await apiClient
        .node()
        .joinContext(props.invitationPayload);
      return { data: result.data as JoinContextResponse, error: null };
    } catch (error) {
      console.error('joinContext failed:', error);
      let errorMessage = 'An unexpected error occurred during joinContext';
      if (error instanceof Error) {
        errorMessage = error.message;
      }
      return {
        data: undefined,
        error: {
          code: 500,
          message: errorMessage,
        },
      };
    }
  }

  async verifyContext(
    props: VerifyContextProps,
  ): Promise<{ data?: VerifyContextResponse; error?: any }> {
    try {
      if (this.app) {
        const result = await this.app.verifyContext({
          contextId: props.contextId,
        });
        return { data: { joined: result.joined || false }, error: null };
      }
    } catch (error) {
      console.warn('App verifyContext failed, falling back to API:', error);
    }

    try {
      const result = await apiClient.node().getContext(props.contextId);
      return { data: { joined: !!result.data }, error: null };
    } catch (error) {
      console.error('Error fetching context:', error);
      return {
        data: undefined,
        error: { code: 500, message: 'Failed to fetch context data.' },
      };
    }
  }
}
