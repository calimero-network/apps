import { type ApiResponse } from '@calimero-network/calimero-client';
import { ContextApiDataSource } from './dataSource/nodeApiDataSource';
import { ClientApiDataSource } from './dataSource/ClientApiDataSource';
import { Agreement, ContextMetadata } from './clientApi';
import { CreateContextProps, CreateContextResponse } from './nodeApi';

export class AgreementService {
  private contextApi: ContextApiDataSource;
  private clientApi: ClientApiDataSource;

  constructor() {
    this.contextApi = new ContextApiDataSource();
    this.clientApi = new ClientApiDataSource();
  }


  async createAgreement(
    name: string,
  ): ApiResponse<Agreement> {
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
        contextData.memberPublicKey, 
        name,
      );

      if (joinResponse.error) {
        console.error('Failed to join created context:', joinResponse.error);
       
      }

      
      const agreement: Agreement = {
        id: contextData.contextId,
        name,
        contextId: contextData.contextId,
        memberPublicKey: contextData.memberPublicKey,
        role: 'Owner', 
        joinedAt: Date.now(),
        privateIdentity: contextData.memberPublicKey, 
        sharedIdentity: contextData.memberPublicKey,
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

      const contexts = contextsResponse.data as ContextMetadata[];



      if (!contexts || !Array.isArray(contexts)) {
        console.error(
          'AgreementService: Invalid contexts data, expected array but got:',
          typeof contexts,
          contexts,
        );
        return {
          data: [],
          error: null,
        };
      }

      // Convert contexts to agreements
      const agreements: Agreement[] = contexts.map((context) => ({
        id: context.context_id,
        name: context.context_name,
        contextId: context.context_id,
        memberPublicKey: context.shared_identity,
        role: context.role,
        joinedAt: context.joined_at,
        privateIdentity: context.private_identity,
        sharedIdentity: context.shared_identity,
      }));



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
