import {
  type ApiResponse,
  getContextId,
  getExecutorPublicKey,
  setContextId,
  setExecutorPublicKey,
} from '@calimero-network/calimero-client';
import { ContextApiDataSource } from './dataSource/nodeApiDataSource';
import { ClientApiDataSource } from './dataSource/ClientApiDataSource';
import { Agreement } from './clientApi';
import { CreateContextProps, CreateContextResponse } from './nodeApi';
import { resolveAgreementName } from '../lib/agreementName';
import bs58 from 'bs58';

/**
 * Convert a value to base58 string.
 * Handles byte arrays from the contract and passes through strings.
 */
function toBase58String(value: string | number[] | Uint8Array): string {
  if (typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value)) {
    return bs58.encode(new Uint8Array(value));
  }
  if (value instanceof Uint8Array) {
    return bs58.encode(value);
  }
  return String(value);
}

export class AgreementService {
  private contextApi: ContextApiDataSource;
  private clientApi: ClientApiDataSource;

  constructor(app?: any) {
    this.contextApi = new ContextApiDataSource(app);
    this.clientApi = new ClientApiDataSource(app);
  }

  async createAgreement(name: string): ApiResponse<Agreement> {
    try {
      const contextProps: CreateContextProps = {
        is_private: false, // Shared context
        context_name: name,
      };

      const contextResponse = await this.contextApi.createContext(contextProps);

      if (contextResponse.error) {
        return {
          data: null,
          error: contextResponse.error,
        };
      }

      const contextData = contextResponse.data as CreateContextResponse;

      const joinResponse = await this.clientApi.joinSharedContext(
        contextData.contextId,
        contextData.executorId,
        name,
      );

      if (joinResponse.error) {
        console.error('Failed to join created context:', joinResponse.error);
      }

      const agreement: Agreement = {
        id: contextData.contextId,
        name,
        contextId: contextData.contextId,
        memberPublicKey: contextData.executorId,
        role: 'Owner',
        joinedAt: Date.now(),
        privateIdentity: contextData.executorId,
        sharedIdentity: contextData.executorId,
      };

      return {
        data: agreement,
        error: null,
      };
    } catch (error) {
      console.error('createAgreement failed:', error);
      let errorMessage = 'An unexpected error occurred during createAgreement';
      if (error instanceof Error) {
        errorMessage = error.message;
      } else if (typeof error === 'string') {
        errorMessage = error;
      }
      return {
        data: null,
        error: {
          code: 500,
          message: errorMessage,
        },
      };
    }
  }

  // List all agreements (joined contexts)
  async listAgreements(): ApiResponse<Agreement[]> {
    try {
      const contextsResponse = await this.clientApi.listJoinedContexts();

      if (contextsResponse.error) {
        console.error(
          'AgreementService: Error from clientApi:',
          contextsResponse.error,
        );
        return {
          data: null,
          error: contextsResponse.error,
        };
      }

      let contextsArray: any[] = [];
      const responseData = contextsResponse.data;

      if (Array.isArray(responseData)) {
        contextsArray = responseData;
      } else if (responseData && Array.isArray(responseData.output)) {
        contextsArray = responseData.output;
      } else if (responseData && Array.isArray(responseData.result)) {
        contextsArray = responseData.result;
      } else {
        console.error(
          'AgreementService: Invalid contexts data, expected array but got:',
          typeof responseData,
          responseData,
        );
        return {
          data: [],
          error: null,
        };
      }

      const agreements: Agreement[] = contextsArray.map((context: any) => {
        // Convert context_id from byte array to base58 string if needed
        const contextId = context.contextId
          ? typeof context.contextId === 'string'
            ? context.contextId
            : toBase58String(context.contextId)
          : context.context_id
            ? typeof context.context_id === 'string'
              ? context.context_id
              : toBase58String(context.context_id)
            : '';

        if (context.contextId || context.context_id) {
          return {
            id: contextId,
            name: resolveAgreementName({
              stored: context.context_name,
              contextId,
            }),
            contextId: contextId,
            memberPublicKey: context.executorId || toBase58String(context.shared_identity),
            role: context.role || ' ',
            joinedAt: context.joinedAt || context.joined_at || ' ',
            privateIdentity: context.executorId || toBase58String(context.private_identity),
            sharedIdentity: context.executorId || toBase58String(context.shared_identity),
          };
        }

        // Handle old API structure (fallback)
        // Convert byte arrays to base58 strings
        const sharedIdentity = toBase58String(context.shared_identity);
        const privateIdentity = toBase58String(context.private_identity);

        return {
          id: contextId,
          name: resolveAgreementName({
            stored: context.context_name,
            contextId,
          }),
          contextId: contextId,
          memberPublicKey: sharedIdentity,
          role: context.role,
          joinedAt: context.joined_at,
          privateIdentity: privateIdentity,
          sharedIdentity: sharedIdentity,
        };
      });

      return {
        data: agreements,
        error: null,
      };
    } catch (error) {
      console.error('listAgreements failed:', error);
      let errorMessage = 'An unexpected error occurred during listAgreements';
      if (error instanceof Error) {
        errorMessage = error.message;
      } else if (typeof error === 'string') {
        errorMessage = error;
      }
      return {
        data: null,
        error: {
          code: 500,
          message: errorMessage,
        },
      };
    }
  }

  // ── The name every node agrees on ─────────────────────────────────────────
  //
  // `listAgreements` reads each agreement's name out of THIS node's private
  // context, where it was written once at join time. That snapshot is fast (one
  // call, no per-agreement round trips) and it is what the dashboard paints
  // first — but it is a snapshot, and it is the thing that used to be wrong: a
  // joiner recorded whatever they had typed, or the literal word 'Agreement'.
  //
  // The agreement's OWN context holds `context_name` in contract state, which
  // replicates. That is the only value that can be the same on the creator's
  // node and on everybody else's, so it is the one the list should show. This
  // asks each agreement for it and hands back the rows with the shared name
  // merged in, leaving the stored name in place wherever the shared context has
  // not synced or cannot be read yet.
  //
  // Deliberately a SECOND pass rather than part of `listAgreements`: it costs one
  // contract call per agreement, and blocking the dashboard on that would make
  // an empty screen the first thing a user sees.
  //
  // ⚠️ `getContextDetails` sets the client's global executor key as a side
  // effect, which is how the whole data-source layer is built. Iterating over
  // agreements therefore leaves it pointing at the last one, so the previous
  // values are captured and restored.
  async resolveSharedNames(agreements: Agreement[]): Promise<Agreement[]> {
    if (agreements.length === 0) return agreements;

    const previousContextId = getContextId();
    const previousExecutor = getExecutorPublicKey();

    try {
      const resolved: Agreement[] = [];
      for (const agreement of agreements) {
        let fromContract: string | undefined;
        try {
          const details = await this.clientApi.getContextDetails(
            agreement.contextId,
            agreement.contextId,
            agreement.sharedIdentity,
          );
          fromContract = details.data?.context_name;
        } catch (error) {
          console.warn(
            `Could not read the shared name for ${agreement.contextId}:`,
            error,
          );
        }

        resolved.push({
          ...agreement,
          name: resolveAgreementName({
            fromContract,
            stored: agreement.name,
            contextId: agreement.contextId,
          }),
        });
      }
      return resolved;
    } finally {
      if (previousContextId) setContextId(previousContextId);
      if (previousExecutor) setExecutorPublicKey(previousExecutor);
    }
  }

  // Leave an agreement (shared context)
  // async leaveAgreement(agreementId: string): ApiResponse<void> {
  //   try {
  //     return await this.clientApi.leaveSharedContext(agreementId);
  //   } catch (error) {
  //     console.error('leaveAgreement failed:', error);
  //     let errorMessage = 'An unexpected error occurred during leaveAgreement';
  //     if (error instanceof Error) {
  //       errorMessage = error.message;
  //     } else if (typeof error === 'string') {
  //       errorMessage = error;
  //     }
  //     return {
  //       data: null,
  //       error: {
  //         code: 500,
  //         message: errorMessage,
  //       },
  //     };
  //   }
  // }

  // Invite someone to an agreement
  async inviteToAgreement(
    agreementId: string,
    inviteeId: string,
    inviterId: string,
  ): ApiResponse<string> {
    try {
      return await this.contextApi.inviteToContext({
        contextId: agreementId,
        invitee: inviteeId,
        inviter: inviterId,
      });
    } catch (error) {
      console.error('inviteToAgreement failed:', error);
      let errorMessage =
        'An unexpected error occurred during inviteToAgreement';
      if (error instanceof Error) {
        errorMessage = error.message;
      } else if (typeof error === 'string') {
        errorMessage = error;
      }
      return {
        data: null,
        error: {
          code: 500,
          message: errorMessage,
        },
      };
    }
  }

  // Join an agreement using invitation payload
  async joinAgreement(invitationPayload: string): ApiResponse<string> {
    try {
      const joinResponse = await this.contextApi.joinContext({
        invitationPayload,
      });

      if (joinResponse.error) {
        return {
          data: null,
          error: joinResponse.error,
        };
      }

      const contextId = joinResponse.data?.contextId || '';

      return {
        data: contextId,
        error: null,
      };
    } catch (error) {
      console.error('joinAgreement failed:', error);
      let errorMessage = 'An unexpected error occurred during joinAgreement';
      if (error instanceof Error) {
        errorMessage = error.message;
      } else if (typeof error === 'string') {
        errorMessage = error;
      }
      return {
        data: null,
        error: {
          code: 500,
          message: errorMessage,
        },
      };
    }
  }

  // Verify if a context exists and is joined
  async verifyAgreement(agreementId: string): ApiResponse<boolean> {
    try {
      const verifyResponse = await this.contextApi.verifyContext({
        contextId: agreementId,
      });

      if (verifyResponse.error) {
        return {
          data: null,
          error: verifyResponse.error,
        };
      }

      return {
        data: verifyResponse.data?.joined || false,
        error: null,
      };
    } catch (error) {
      console.error('verifyAgreement failed:', error);
      let errorMessage = 'An unexpected error occurred during verifyAgreement';
      if (error instanceof Error) {
        errorMessage = error.message;
      } else if (typeof error === 'string') {
        errorMessage = error;
      }
      return {
        data: null,
        error: {
          code: 500,
          message: errorMessage,
        },
      };
    }
  }
}
