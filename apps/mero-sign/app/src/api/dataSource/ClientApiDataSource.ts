import {
  type ApiResponse,
  type RpcQueryParams,
  rpcClient,
  getAuthConfig,
  getAppEndpointKey,
  getExecutorPublicKey,
  setExecutorPublicKey,
  getContextId,
} from '../../lib/node';
import {
  ClientApi,
  ClientMethod,
  ContextDetails,
  PermissionLevel,
  UserId,
} from '../clientApi';
import { DefaultContextService } from '../defaultContextService';
import { toHexId } from '../../lib/participants';
import bs58 from 'bs58';
import { clientFor } from '../../lib/signClient';
import type { ErrorResponse } from '../../lib/node';
import type { SignatureRecord } from '../../generated/MeroSignClient';

const RequestConfig = {
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 10000,
};

function getErrorMessage(error: any): string {
  if (
    error?.type === 'Uninitialized' ||
    error?.message?.includes('Uninitialized')
  ) {
    return 'Syncing state, Please wait and retry.';
  }
  if (
    error?.error?.name === 'UnknownServerError' &&
    error?.error?.cause?.info?.message?.includes(
      'Verify that the node server is running',
    )
  ) {
    return 'Syncing state, Please wait and retry.';
  }
  if (typeof error === 'string') return error;
  if (error?.message) return error.message;
  if (error?.data) return JSON.stringify(error.data);
  return 'An unexpected error occurred';
}
function getContextSpecificAuthConfig(
  agreementContextID: string,
  agreementContextUserID: string,
) {
  const baseAuthConfig = getAuthConfig();
  return {
    appEndpointKey: getAppEndpointKey(),
    contextId: agreementContextID,
    executorPublicKey: agreementContextUserID,
    jwtToken: baseAuthConfig.jwtToken,
    error: null,
  };
}

// ── Helpers for the generated-client methods ────────────────────────────────

/**
 * This node's private context, which is where signatures live.
 *
 * Read from the record `DefaultContextService` stores. Returns "" rather than
 * throwing so the caller can answer in words — a missing private context is
 * an ordinary state on a node that has just connected, not an exception.
 */
function privateContextId(): string {
  try {
    return localStorage.getItem('defaultContextId') ?? '';
  } catch {
    return '';
  }
}

function noPrivateContext(): { data: null; error: ErrorResponse } {
  return {
    data: null,
    error: {
      code: 409,
      message:
        'Your private signature store is not ready on this node yet. Give it ' +
        'a moment and try again.',
    },
  };
}

/**
 * The node's own words, not a generic sentence about this repo's files.
 *
 * ⚠️ VIA `getErrorMessage`, not `instanceof Error`. A rejected RPC arrives as
 * a plain object or a string as often as an `Error`, and an `instanceof` test
 * turns those into "Could not …" — losing exactly the reason this change
 * exists to surface. `getErrorMessage` already unpacks every shape this file
 * has met, including core's "Uninitialized", which means "retry" rather than
 * "failed".
 */
function failed(
  what: string,
  error: unknown,
): { data: null; error: ErrorResponse } {
  const message = getErrorMessage(error);
  return {
    data: null,
    error: {
      code: 500,
      message:
        message && message !== 'An unexpected error occurred'
          ? message
          : `Could not ${what}.`,
    },
  };
}

export class ClientApiDataSource implements ClientApi {
  private app: any;

  constructor(app?: any) {
    this.app = app;
  }

  /**
   * Record MY consent to sign a document.
   *
   * ⚠️ The `userId` parameter is gone. The contract used to take one and store
   * consent against it with no gate at all, and consent was the only
   * precondition `sign_document` checked — so the two together let one member
   * manufacture both halves of somebody else's signature. The contract now
   * derives the consenter from `env::account_id()`.
   *
   * `agreementContextUserID` is still passed, and is still correct: it is the
   * EXECUTOR key that identifies which context member is making the call. Its
   * only wrong use was as a signer identity.
   */
  async setConsent(
    documentId: string,
    agreementContextID?: string,
    agreementContextUserID?: string,
  ): ApiResponse<void> {
    try {
      const authConfig =
        agreementContextID && agreementContextUserID
          ? getContextSpecificAuthConfig(
              agreementContextID,
              agreementContextUserID,
            )
          : getAuthConfig();

      const response = await rpcClient.execute(
        {
          contextId: authConfig.contextId || getContextId() || '',
          method: ClientMethod.SET_CONSENT,
          argsJson: {
            document_id: documentId,
          },
          executorPublicKey: (authConfig.executorPublicKey ||
            getExecutorPublicKey() ||
            '') as string,
        },
        RequestConfig,
      );

      if (response?.error) {
        return {
          data: undefined,
          error: {
            code: response.error.code ?? 500,
            message: getErrorMessage(response.error),
          },
        };
      }

      return {
        data: undefined,
        error: null,
      };
    } catch (error: any) {
      console.error('ClientApiDataSource: Error in setConsent:', error);
      return {
        data: null,
        error: {
          code: error.code || 500,
          message: getErrorMessage(error),
        },
      };
    }
  }

  /**
   * Has this ACCOUNT consented to sign this document?
   *
   * ⚠️ The first parameter used to be called `agreementContextUserID` and was
   * used for BOTH the `user_id_str` argument and the executor key — one
   * variable standing for two different identities. It held the context member
   * (DEVICE) key, while consent is stored against the ACCOUNT, and since core
   * rc.27 both are 64 hex characters, so the lookup type-checked and always
   * missed: the consent modal reappeared for people who had already consented.
   * The two are now separate parameters, and callers get their account from
   * `whoami()`.
   */
  async hasConsented(
    userIdStr: UserId,
    documentId: string,
    agreementContextID?: string,
    agreementContextUserID?: string,
  ): ApiResponse<boolean> {
    try {
      const authConfig =
        agreementContextID && agreementContextUserID
          ? getContextSpecificAuthConfig(
              agreementContextID,
              agreementContextUserID,
            )
          : getAuthConfig();

      const response = await rpcClient.execute(
        {
          contextId: authConfig.contextId || getContextId() || '',
          method: ClientMethod.HAS_CONSENTED,
          argsJson: {
            user_id_str: userIdStr,
            document_id: documentId,
          },
          executorPublicKey: (authConfig.executorPublicKey ||
            getExecutorPublicKey() ||
            '') as string,
        },
        RequestConfig,
      );

      if (response?.error) {
        return {
          data: undefined,
          error: {
            code: response.error.code ?? 500,
            message: getErrorMessage(response.error),
          },
        };
      }

      const data = response.result?.output ?? response.result;

      return {
        data: Boolean(data),
        error: null,
      };
    } catch (error: any) {
      console.error('ClientApiDataSource: Error in hasConsented:', error);
      return {
        data: null,
        error: {
          code: error.code || 500,
          message: getErrorMessage(error),
        },
      };
    }
  }

  async addParticipant(
    contextId: string,
    userId: UserId,
    permission: PermissionLevel,
    agreementContextID?: string,
    agreementContextUserID?: string,
  ): ApiResponse<void> {
    try {
      const authConfig =
        agreementContextID && agreementContextUserID
          ? getContextSpecificAuthConfig(
              agreementContextID,
              agreementContextUserID,
            )
          : getAuthConfig();

      if (authConfig.executorPublicKey) {
        setExecutorPublicKey(authConfig.executorPublicKey);
      }
      const response = await rpcClient.execute(
        {
          contextId: authConfig.contextId || getContextId() || '',
          method: ClientMethod.ADD_PARTICIPANT,
          argsJson: {
            user_id_str: userId,
            permission: permission,
          },
          executorPublicKey: (authConfig.executorPublicKey ||
            getExecutorPublicKey() ||
            '') as string,
        },
        RequestConfig,
      );

      if (response?.error) {
        return {
          data: undefined,
          error: {
            code: response.error.code ?? 500,
            message: getErrorMessage(response.error),
          },
        };
      }

      return {
        data: undefined,
        error: null,
      };
    } catch (error: any) {
      console.error('ClientApiDataSource: Error in addParticipant:', error);
      return {
        data: undefined,
        error: {
          code: 500,
          message: getErrorMessage(error),
        },
      };
    }
  }

  /**
   * Change an EXISTING participant's permission level.
   *
   * ⚠️ Raising only. The contract refuses a demotion because permissions merge
   * by taking the higher rank, so a lowered level would apply on the admin's
   * node and be discarded everywhere else. The refusal comes back as an error
   * message explaining that; see `lib/participants.ts`.
   */
  async setParticipantPermission(
    userId: UserId,
    permission: PermissionLevel,
    agreementContextID?: string,
    agreementContextUserID?: string,
  ): ApiResponse<void> {
    return this.mutate(
      ClientMethod.SET_PARTICIPANT_PERMISSION,
      { user_id_str: userId, permission },
      agreementContextID,
      agreementContextUserID,
    );
  }

  /** Remove a participant, taking their permission with them. */
  async removeParticipant(
    userId: UserId,
    agreementContextID?: string,
    agreementContextUserID?: string,
  ): ApiResponse<void> {
    return this.mutate(
      ClientMethod.REMOVE_PARTICIPANT,
      { user_id_str: userId },
      agreementContextID,
      agreementContextUserID,
    );
  }

  /**
   * The caller's ACCOUNT id, straight from the contract.
   *
   * The app cannot work this out for itself: it holds
   * `localStorage['agreementContextUserID']`, which is the context member
   * (DEVICE) key from the join response, while every permission is keyed by
   * account — and since core rc.27 both are 64 hex characters, so comparing the
   * wrong pair type-checks and silently matches nothing. Asking the contract is
   * the only way to know which row of the roster is you.
   */
  async whoami(
    agreementContextID?: string,
    agreementContextUserID?: string,
  ): ApiResponse<UserId> {
    const res = await this.query(
      ClientMethod.WHOAMI,
      {},
      agreementContextID,
      agreementContextUserID,
    );
    if (res.error) return { data: null, error: res.error };
    return { data: toHexId(res.data as never), error: null };
  }

  /**
   * One place the three-line auth dance and the error unwrapping live, instead
   * of a copy per method. Used by the calls added with roles; the older methods
   * are left as they are rather than rewritten under an unrelated change.
   */
  private async mutate(
    method: ClientMethod,
    argsJson: Record<string, unknown>,
    agreementContextID?: string,
    agreementContextUserID?: string,
  ): ApiResponse<void> {
    const res = await this.query(
      method,
      argsJson,
      agreementContextID,
      agreementContextUserID,
    );
    if (res.error) return { data: undefined, error: res.error };
    return { data: undefined, error: null };
  }

  private async query(
    method: ClientMethod,
    argsJson: Record<string, unknown>,
    agreementContextID?: string,
    agreementContextUserID?: string,
  ): ApiResponse<unknown> {
    try {
      const authConfig =
        agreementContextID && agreementContextUserID
          ? getContextSpecificAuthConfig(
              agreementContextID,
              agreementContextUserID,
            )
          : getAuthConfig();

      if (authConfig.executorPublicKey) {
        setExecutorPublicKey(authConfig.executorPublicKey);
      }

      const response = await rpcClient.execute(
        {
          contextId: authConfig.contextId || getContextId() || '',
          method,
          argsJson,
          executorPublicKey: (authConfig.executorPublicKey ||
            getExecutorPublicKey() ||
            '') as string,
        },
        RequestConfig,
      );

      if (response?.error) {
        return {
          data: null,
          error: {
            code: response.error.code ?? 500,
            message: getErrorMessage(response.error),
          },
        };
      }

      return { data: response.result?.output ?? response.result, error: null };
    } catch (error: any) {
      console.error(`ClientApiDataSource: Error in ${method}:`, error);
      return {
        data: null,
        error: { code: 500, message: getErrorMessage(error) },
      };
    }
  }

  // Register self as participant in a shared context (for users who joined via invitation)
  async registerSelfAsParticipant(
    agreementContextID: string,
    agreementContextUserID: string,
  ): ApiResponse<void> {
    try {
      const response = await rpcClient.execute(
        {
          contextId: agreementContextID,
          method: ClientMethod.REGISTER_SELF_AS_PARTICIPANT,
          argsJson: {},
          executorPublicKey: agreementContextUserID,
        },
        RequestConfig,
      );

      if (response?.error) {
        return {
          data: undefined,
          error: {
            code: response.error.code ?? 500,
            message: getErrorMessage(response.error),
          },
        };
      }

      return {
        data: undefined,
        error: null,
      };
    } catch (error: any) {
      console.error(
        'ClientApiDataSource: Error in registerSelfAsParticipant:',
        error,
      );
      return {
        data: undefined,
        error: {
          code: 500,
          message: getErrorMessage(error),
        },
      };
    }
  }

  async isDefaultPrivateContext(): ApiResponse<boolean> {
    try {
      if (this.app) {
        const defaultContextService = DefaultContextService.getInstance(
          this.app,
        );
        const defaultContext = defaultContextService.getStoredDefaultContext();

        if (!defaultContext) {
          throw new Error(
            'Default context not found. Please ensure you are connected to Calimero and have a default context initialized.',
          );
        }

        const result = await this.app.execute(
          // ⚠️ `.contextId`, not the record. `execute` takes a CONTEXT ID;
          // handing it the whole `DefaultContextInfo` sends a JSON object
          // where the node wants a hash, and it answers
          // `ParseError: invalid type: map, expected a hex encoded hash`.
          // Every call on this private-context surface did it, and every one
          // of them is inside a `try/catch` that falls back or returns empty
          // — so the signature library and the local agreement registry
          // failed silently rather than reporting anything.
          defaultContext.contextId,
          ClientMethod.IS_DEFAULT_PRIVATE_CONTEXT,
          {},
        );

        return {
          data: result.data || result,
          error: null,
        };
      } else {
        // Fallback to old API
        const authConfig = getAuthConfig();

        const response = await rpcClient.execute(
          {
            contextId: authConfig.contextId || getContextId() || '',
            method: ClientMethod.IS_DEFAULT_PRIVATE_CONTEXT,
            argsJson: {},
            executorPublicKey: (authConfig.executorPublicKey ||
              getExecutorPublicKey() ||
              '') as string,
          },
          RequestConfig,
        );

        if (response?.error) {
          return {
            data: undefined,
            error: {
              code: response.error.code ?? 500,
              message: getErrorMessage(response.error),
            },
          };
        }

        const data = response.result?.output || response.result;

        return {
          data: data as boolean,
          error: null,
        };
      }
    } catch (error: any) {
      console.error(
        'ClientApiDataSource: Error in isDefaultPrivateContext:',
        error,
      );
      return {
        data: undefined,
        error: {
          code: 500,
          message: getErrorMessage(error),
        },
      };
    }
  }
  async getContextDetails(
    contextId: string,
    agreementContextID?: string,
    agreementContextUserID?: string,
  ): ApiResponse<ContextDetails> {
    try {
      const authConfig =
        agreementContextID && agreementContextUserID
          ? getContextSpecificAuthConfig(
              agreementContextID,
              agreementContextUserID,
            )
          : getAuthConfig();

      if (authConfig.executorPublicKey) {
        setExecutorPublicKey(authConfig.executorPublicKey);
      }
      const response = await rpcClient.execute(
        {
          contextId: authConfig.contextId || getContextId() || '',
          method: ClientMethod.GET_CONTEXT_DETAILS,
          argsJson: {
            context_id_str: contextId,
          },
          executorPublicKey: (authConfig.executorPublicKey ||
            getExecutorPublicKey() ||
            '') as string,
        },
        RequestConfig,
      );

      if (response?.error) {
        return {
          data: undefined,
          error: {
            code: response.error.code ?? 500,
            message: getErrorMessage(response.error),
          },
        };
      }

      let data: any = response.result?.output || response.result;

      // Convert context_id from byte array to base58 string if needed
      if (data && typeof data === 'object' && data.context_id) {
        if (typeof data.context_id !== 'string') {
          if (Array.isArray(data.context_id)) {
            data.context_id = bs58.encode(new Uint8Array(data.context_id));
          } else if (data.context_id instanceof Uint8Array) {
            data.context_id = bs58.encode(data.context_id);
          }
        }
      }

      return {
        data: data as ContextDetails,
        error: null,
      };
    } catch (error: any) {
      console.error('ClientApiDataSource: Error in getContextDetails:', error);
      return {
        data: null,
        error: {
          code: error.code || 500,
          message: getErrorMessage(error),
        },
      };
    }
  }
  /**
   * Sign a document AS MYSELF.
   *
   * ⚠️ The `signerId` parameter is gone, and its absence is the point. The
   * contract used to take `signer_id_str` and write it straight into
   * `DocumentSignature.signer` with no check against the caller, so any member
   * could record a signature attributed to another member. This app handed it
   * `localStorage['agreementContextUserID']` — the context member DEVICE key —
   * while the contract keys participants and permissions by ACCOUNT, so the
   * recorded signer matched nobody in the roster and no document could ever
   * reach `FullySigned` either.
   *
   * The contract now derives the signer from `env::account_id()`. Nothing here
   * can name a signer, so nothing here can name the wrong one.
   *
   * The executor key is still the device key, which is its correct use: it says
   * which context member is making the call, not who is signing.
   */
  async signDocument(
    contextId: string,
    documentId: string,
    pdfBlobIdStr: string,
    fileSize: number,
    newHash: string,
    agreementContextID?: string,
    agreementContextUserID?: string,
  ): ApiResponse<void> {
    try {
      const authConfig =
        agreementContextID && agreementContextUserID
          ? getContextSpecificAuthConfig(
              agreementContextID,
              agreementContextUserID,
            )
          : getAuthConfig();

      const executorPublicKey = (authConfig?.executorPublicKey ||
        getExecutorPublicKey() ||
        '') as string;

      if (!contextId || !executorPublicKey) {
        return {
          data: null,
          error: {
            code: 500,
            message: 'Authentication configuration not found',
          },
        };
      }

      const params: RpcQueryParams<{
        document_id: string;
        pdf_blob_id_str: string;
        file_size: number;
        new_hash: string;
      }> = {
        contextId: contextId,
        method: ClientMethod.SIGN_DOCUMENT,
        argsJson: {
          document_id: documentId,
          pdf_blob_id_str: pdfBlobIdStr,
          file_size: fileSize,
          new_hash: newHash,
        },
        executorPublicKey,
      };

      const response = await rpcClient.execute<
        {
          document_id: string;
          pdf_blob_id_str: string;
          file_size: number;
          new_hash: string;
        },
        void
      >(params, RequestConfig);

      if (response?.error) {
        return {
          error: {
            code: response.error.code ?? 500,
            message: getErrorMessage(response.error),
          },
        };
      }

      return {
        data: undefined,
        error: null,
      };
    } catch (error) {
      console.error('ClientApiDataSource: Error in signDocument:', error);
      return {
        error: {
          code: 500,
          message:
            error instanceof Error
              ? error.message
              : 'An unexpected error occurred',
        },
      };
    }
  }

  // private dataURLToUint8Array(dataURL: string): Uint8Array {
  //   const base64String = dataURL.split(',')[1];
  //   const binaryString = atob(base64String);
  //   const bytes = new Uint8Array(binaryString.length);
  //   for (let i = 0; i < binaryString.length; i++) {
  //     bytes[i] = binaryString.charCodeAt(i);
  //   }
  //   return bytes;
  // }

  // private uint8ArrayToDataURL(uint8Array: Uint8Array): string {
  //   const base64String = btoa(String.fromCharCode(...uint8Array));
  //   return `data:image/png;base64,${base64String}`;
  // }

  /**
   * ⚠️ THROUGH THE GENERATED CLIENT. What was here read the stored default
   * context, passed the whole RECORD to `execute` where a context ID belongs,
   * and caught the node's `ParseError: invalid type: map, expected a hex
   * encoded hash` into a `console.warn` before trying a second path. The
   * signature's blob uploaded, the contract call was refused, and the row
   * never existed — which read as "it saves but is not displayed".
   *
   * `MeroSignClient` takes the context ID in its constructor and the ABI's
   * own argument names, so neither mistake is expressible. It THROWS, and the
   * envelope below is built from that rather than from a swallowed warning.
   */
  async createSignature(
    name: string,
    blobIdStr: string,
    dataSize: number,
  ): ApiResponse<number> {
    const contextId = privateContextId();
    if (!contextId) return noPrivateContext();
    try {
      const data = await clientFor(contextId).createSignature({
        name,
        blob_id_str: blobIdStr,
        data_size: dataSize,
      });
      return { data, error: null };
    } catch (error) {
      return failed('create the signature', error);
    }
  }

  async deleteSignature(signatureId: number): ApiResponse<void> {
    const contextId = privateContextId();
    if (!contextId) return noPrivateContext();
    try {
      await clientFor(contextId).deleteSignature({ signature_id: signatureId });
      return { data: undefined as unknown as void, error: null };
    } catch (error) {
      return failed('delete that signature', error);
    }
  }

  async listSignatures(): ApiResponse<SignatureRecord[]> {
    const contextId = privateContextId();
    if (!contextId) return noPrivateContext();
    try {
      return { data: await clientFor(contextId).listSignatures(), error: null };
    } catch (error) {
      return failed('list your signatures', error);
    }
  }

  async joinSharedContext(
    contextId: string,
    sharedIdentity: UserId,
    name: string,
  ): Promise<any> {
    try {
      if (!sharedIdentity) {
        throw new Error(
          'sharedIdentity parameter is required but was not provided',
        );
      }

      if (this.app) {
        const defaultContextService = DefaultContextService.getInstance(
          this.app,
        );
        const defaultContext = defaultContextService.getStoredDefaultContext();

        if (!defaultContext) {
          throw new Error(
            'Default context not found. Please ensure you are connected to Calimero and have a default context initialized.',
          );
        }

        const params = {
          context_id_str: contextId,
          shared_identity_str: sharedIdentity,
          context_name: name,
        };

        const result = await this.app.execute(
          // ⚠️ `.contextId`, not the record. `execute` takes a CONTEXT ID;
          // handing it the whole `DefaultContextInfo` sends a JSON object
          // where the node wants a hash, and it answers
          // `ParseError: invalid type: map, expected a hex encoded hash`.
          // Every call on this private-context surface did it, and every one
          // of them is inside a `try/catch` that falls back or returns empty
          // — so the signature library and the local agreement registry
          // failed silently rather than reporting anything.
          defaultContext.contextId,
          ClientMethod.JOIN_SHARED_CONTEXT,
          params,
        );

        return {
          data: result.data || result,
        };
      } else {
        // Fallback to old API
        const argsJson: any = {
          context_id_str: contextId,
          shared_identity_str: sharedIdentity,
          context_name: name,
        };
        const authConfig = getAuthConfig();
        const response = await rpcClient.execute(
          {
            contextId: authConfig.contextId || getContextId() || '',
            method: ClientMethod.JOIN_SHARED_CONTEXT,
            argsJson,
            executorPublicKey: (authConfig.executorPublicKey ||
              getExecutorPublicKey() ||
              '') as string,
          },
          RequestConfig,
        );
        return {
          data: response.result,
        };
      }
    } catch (error: any) {
      console.error('ClientApiDataSource: Error in joinSharedContext:', error);
      return {
        error: error,
      };
    }
  }

  async listJoinedContexts(): Promise<any> {
    try {
      if (this.app) {
        // Get default context using the service
        const defaultContextService = DefaultContextService.getInstance(
          this.app,
        );

        // Try to get stored context first
        let defaultContext = defaultContextService.getStoredDefaultContext();

        // If no stored context, ensure one exists
        if (!defaultContext) {
          const ensureResult =
            await defaultContextService.ensureDefaultContext();

          if (!ensureResult.success || !ensureResult.contextInfo) {
            throw new Error(
              'Failed to ensure default context: ' +
                (ensureResult.error || 'Unknown error'),
            );
          }

          defaultContext = ensureResult.contextInfo;
        }

        const result = await this.app.execute(
          // ⚠️ `.contextId`, not the record. `execute` takes a CONTEXT ID;
          // handing it the whole `DefaultContextInfo` sends a JSON object
          // where the node wants a hash, and it answers
          // `ParseError: invalid type: map, expected a hex encoded hash`.
          // Every call on this private-context surface did it, and every one
          // of them is inside a `try/catch` that falls back or returns empty
          // — so the signature library and the local agreement registry
          // failed silently rather than reporting anything.
          defaultContext.contextId,
          ClientMethod.LIST_JOINED_CONTEXTS,
          {},
        );

        const data = result.data || result;

        // Convert context_id from byte array to base58 string if needed
        if (Array.isArray(data)) {
          data.forEach((context: any) => {
            if (context.context_id && typeof context.context_id !== 'string') {
              if (Array.isArray(context.context_id)) {
                context.context_id = bs58.encode(
                  new Uint8Array(context.context_id),
                );
              } else if (context.context_id instanceof Uint8Array) {
                context.context_id = bs58.encode(context.context_id);
              }
            }
          });
        }

        return {
          data: data,
        };
      } else {
        // Fallback to old API

        const authConfig = getAuthConfig();

        const response = await rpcClient.execute(
          {
            contextId: authConfig.contextId || getContextId() || '',
            method: ClientMethod.LIST_JOINED_CONTEXTS,
            argsJson: {},
            executorPublicKey: (authConfig.executorPublicKey ||
              getExecutorPublicKey() ||
              '') as string,
          },
          RequestConfig,
        );

        const data = response.result?.output || response.result;

        // Convert context_id from byte array to base58 string if needed
        if (Array.isArray(data)) {
          data.forEach((context: any) => {
            if (context.context_id && typeof context.context_id !== 'string') {
              if (Array.isArray(context.context_id)) {
                context.context_id = bs58.encode(
                  new Uint8Array(context.context_id),
                );
              } else if (context.context_id instanceof Uint8Array) {
                context.context_id = bs58.encode(context.context_id);
              }
            }
          });
        }

        return {
          data: data,
        };
      }
    } catch (error: any) {
      console.error('ClientApiDataSource: Error in listJoinedContexts:', error);
      return {
        error: error,
      };
    }
  }

  async leaveSharedContext(contextId: string): Promise<any> {
    try {
      const authConfig = getAuthConfig();
      const response = await rpcClient.execute(
        {
          contextId: authConfig.contextId || getContextId() || '',
          method: ClientMethod.LEAVE_SHARED_CONTEXT,
          argsJson: {
            context_id: contextId,
          },
          executorPublicKey: (authConfig.executorPublicKey ||
            getExecutorPublicKey() ||
            '') as string,
        },
        RequestConfig,
      );
      return {
        data: response.result,
      };
    } catch (error: any) {
      return {
        error: error,
      };
    }
  }

  async uploadDocument(
    contextId: string,
    name: string,
    hash: string,
    pdfBlobIdStr: string,
    fileSize: number,
    embeddings?: number[],
    extractedText?: string,
    chunks?: any[], // Add chunks parameter
    agreementContextID?: string,
    agreementContextUserID?: string,
  ): Promise<any> {
    try {
      const authConfig =
        agreementContextID && agreementContextUserID
          ? getContextSpecificAuthConfig(
              agreementContextID,
              agreementContextUserID,
            )
          : getAuthConfig();

      if (authConfig.executorPublicKey) {
        setExecutorPublicKey(authConfig.executorPublicKey);
      }
      const response = await rpcClient.execute(
        {
          contextId: authConfig.contextId || contextId || getContextId() || '',
          method: ClientMethod.UPLOAD_DOCUMENT,
          argsJson: {
            name,
            hash,
            pdf_blob_id_str: pdfBlobIdStr,
            file_size: fileSize,
            embeddings,
            extracted_text: extractedText,
            chunks,
          },
          executorPublicKey: (authConfig.executorPublicKey ||
            getExecutorPublicKey() ||
            '') as string,
        },
        RequestConfig,
      );

      if (response?.error) {
        return {
          data: null,
          error: {
            code: response.error.code ?? 500,
            message: getErrorMessage(response.error),
          },
        };
      }

      const data = response.result?.output || response.result;

      return {
        data: data,
        error: null,
      };
    } catch (error: any) {
      console.error('ClientApiDataSource: Error in uploadDocument:', error);
      return {
        data: null,
        error: {
          code: error.code || 500,
          message: getErrorMessage(error),
        },
      };
    }
  }

  async deleteDocument(
    documentId: string,
    agreementContextID?: string,
    agreementContextUserID?: string,
  ): Promise<any> {
    try {
      const authConfig =
        agreementContextID && agreementContextUserID
          ? getContextSpecificAuthConfig(
              agreementContextID,
              agreementContextUserID,
            )
          : getAuthConfig();

      if (authConfig.executorPublicKey) {
        setExecutorPublicKey(authConfig.executorPublicKey);
      }
      const response = await rpcClient.execute(
        {
          contextId: authConfig.contextId || getContextId() || '',
          method: ClientMethod.DELETE_DOCUMENT,
          argsJson: {
            document_id: documentId,
          },
          executorPublicKey: (authConfig.executorPublicKey ||
            getExecutorPublicKey() ||
            '') as string,
        },
        RequestConfig,
      );

      if (response?.error) {
        return {
          data: null,
          error: {
            code: response.error.code ?? 500,
            message: getErrorMessage(response.error),
          },
        };
      }

      return {
        data: undefined,
        error: null,
      };
    } catch (error: any) {
      console.error('ClientApiDataSource: Error in deleteDocument:', error);
      return {
        data: null,
        error: {
          code: error.code || 500,
          message: getErrorMessage(error),
        },
      };
    }
  }

  async listDocuments(
    contextId: string,
    agreementContextID?: string,
    agreementContextUserID?: string,
  ): Promise<any> {
    try {
      const authConfig =
        agreementContextID && agreementContextUserID
          ? getContextSpecificAuthConfig(
              agreementContextID,
              agreementContextUserID,
            )
          : getAuthConfig();

      if (authConfig.executorPublicKey) {
        setExecutorPublicKey(authConfig.executorPublicKey);
      }
      const response = await rpcClient.execute(
        {
          contextId: authConfig.contextId || contextId || getContextId() || '',
          method: ClientMethod.LIST_DOCUMENTS,
          argsJson: {},
          executorPublicKey: (authConfig.executorPublicKey ||
            getExecutorPublicKey() ||
            '') as string,
        },
        RequestConfig,
      );

      if (response?.error) {
        return {
          data: null,
          error: {
            code: response.error.code ?? 500,
            message: getErrorMessage(response.error),
          },
        };
      }

      const data = response.result?.output || response.result;

      return {
        data: data,
        error: null,
      };
    } catch (error: any) {
      console.error('ClientApiDataSource: Error in listDocuments:', error);
      return {
        data: null,
        error: {
          code: error.code || 500,
          message: getErrorMessage(error),
        },
      };
    }
  }

  /**
   * Recompute a document's status after I have signed it.
   *
   * The `userId` parameter is gone for the same reason as the other two. Note
   * the effect this unlocks: the contract compares recorded signers against
   * `participants`, which holds ACCOUNTS, while signatures held the DEVICE key
   * this app used to pass — so no document could ever reach `FullySigned`.
   */
  async markParticipantSigned(
    contextId: string,
    documentId: string,
    agreementContextID?: string,
    agreementContextUserID?: string,
  ): ApiResponse<void> {
    try {
      const authConfig =
        agreementContextID && agreementContextUserID
          ? getContextSpecificAuthConfig(
              agreementContextID,
              agreementContextUserID,
            )
          : getAuthConfig();

      if (authConfig.executorPublicKey) {
        setExecutorPublicKey(authConfig.executorPublicKey);
      }
      const response = await rpcClient.execute(
        {
          contextId: authConfig.contextId || getContextId() || '',
          method: ClientMethod.MARK_PARTICIPANT_SIGNED,
          argsJson: {
            document_id: documentId,
          },
          executorPublicKey: (authConfig.executorPublicKey ||
            getExecutorPublicKey() ||
            '') as string,
        },
        RequestConfig,
      );

      if (response?.error) {
        return {
          data: undefined,
          error: {
            code: response.error.code ?? 500,
            message: getErrorMessage(response.error),
          },
        };
      }

      return {
        data: undefined,
        error: null,
      };
    } catch (error: any) {
      console.error(
        'ClientApiDataSource: Error in markParticipantSigned:',
        error,
      );
      return {
        data: null,
        error: {
          code: error.code || 500,
          message: getErrorMessage(error),
        },
      };
    }
  }

  async searchDocumentByEmbedding(
    queryEmbedding: number[],
    documentId: string,
    agreementContextID?: string,
    agreementContextUserID?: string,
  ): ApiResponse<string> {
    try {
      const authConfig =
        agreementContextID && agreementContextUserID
          ? getContextSpecificAuthConfig(
              agreementContextID,
              agreementContextUserID,
            )
          : getAuthConfig();

      if (authConfig.executorPublicKey) {
        setExecutorPublicKey(authConfig.executorPublicKey);
      }
      const response = await rpcClient.execute(
        {
          contextId: authConfig.contextId || getContextId() || '',
          method: ClientMethod.SEARCH_DOCUMENT_BY_EMBEDDING,
          argsJson: {
            query_embedding: queryEmbedding,
            document_id: documentId,
          },
          executorPublicKey: (authConfig.executorPublicKey ||
            getExecutorPublicKey() ||
            '') as string,
        },
        RequestConfig,
      );

      if (response?.error) {
        return {
          data: undefined,
          error: {
            code: response.error.code ?? 500,
            message: getErrorMessage(response.error),
          },
        };
      }

      const data = response.result?.output || response.result;

      return {
        data: data as string, // Return the context string
        error: null,
      };
    } catch (error: any) {
      console.error(
        'ClientApiDataSource: Error in searchDocumentByEmbedding:',
        error,
      );
      return {
        data: null,
        error: {
          code: error.code || 500,
          message: getErrorMessage(error),
        },
      };
    }
  }
}
