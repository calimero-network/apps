import React, { useState, useEffect, useRef, useCallback } from 'react';
import { styled } from 'styled-components';
import {
  apiClient,
  type ResponseData,
  setContextId,
  setExecutorPublicKey,
  useCalimero,
} from '@calimero-network/calimero-client';
import type {
  JoinContextResponse,
  NodeIdentity,
  SignedOpenInvitation,
} from '@calimero-network/calimero-client/lib/api/nodeApi';
import { Button, colors } from '@calimero-network/mero-ui';
import {
  clearInvitationFromStorage,
  getInvitationFromStorage,
  extractInvitationFromUrl,
  saveInvitationToStorage,
} from '../utils/invitation';

const Overlay = styled.div`
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.85);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 99999;
  backdrop-filter: blur(8px);
`;

const PopupContainer = styled.div`
  background: #1a1a1f;
  border: 1px solid ${colors.semantic.success.value}40;
  border-radius: 12px;
  padding: 2rem;
  width: 90%;
  max-width: 450px;
  box-shadow: 0 25px 50px rgba(0, 0, 0, 0.5);
`;

const Title = styled.h2`
  color: ${colors.semantic.success.value};
  font-size: 1.4rem;
  font-weight: 600;
  margin-bottom: 1rem;
  text-align: center;
`;

const Message = styled.div<{ type?: 'success' | 'error' | 'info' }>`
  padding: 0.75rem;
  border-radius: 6px;
  font-size: 0.85rem;
  text-align: center;
  margin-bottom: 1rem;
  color: ${({ type }) =>
    type === 'success'
      ? colors.semantic.success.value
      : type === 'error'
        ? colors.semantic.error.value
        : colors.semantic.success.value};
  background: ${({ type }) =>
    type === 'success'
      ? `${colors.semantic.success.value}20`
      : type === 'error'
        ? `${colors.semantic.error.value}20`
        : `${colors.semantic.success.value}20`};
`;

const ButtonGroup = styled.div`
  display: flex;
  gap: 0.5rem;
  margin-top: 1rem;
`;

interface InvitationHandlerPopupProps {
  onSuccess: () => void;
  onError: () => void;
}

export default function InvitationHandlerPopup({
  onSuccess,
  onError,
}: InvitationHandlerPopupProps) {
  const { app } = useCalimero();
  const [status, setStatus] = useState<
    'joining' | 'syncing' | 'registering' | 'error'
  >('joining');
  const [errorMessage, setErrorMessage] = useState('');
  const hasAttemptedJoin = useRef(false);
  const syncIntervalRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const appRef = useRef(app);

  // Keep appRef in sync with the latest app value
  useEffect(() => {
    appRef.current = app;
  }, [app]);

  const waitForContextSync = useCallback(async (contextId: string) => {
    return new Promise<void>((resolve) => {
      let attempts = 0;
      const maxAttempts = 20;
      let timeoutId: ReturnType<typeof setTimeout> | null = null;

      const checkSync = async () => {
        attempts++;
        const checkInterval = attempts <= 5 ? 1000 : 3000;

        if (attempts > maxAttempts) {
          if (timeoutId) {
            clearTimeout(timeoutId);
          }
          console.warn(
            'Context sync taking longer than expected, proceeding anyway',
          );
          // Just resolve - don't call onSuccess here, let the main flow continue
          resolve();
          return;
        }

        try {
          const verifyResponse = await apiClient.node().getContext(contextId);

          if (verifyResponse.data) {
            const isSynced =
              verifyResponse.data.rootHash !==
              '11111111111111111111111111111111';

            if (isSynced) {
              await new Promise((resolve) => setTimeout(resolve, 2000));

              try {
                const finalCheck = await apiClient.node().getContext(contextId);
                if (
                  finalCheck.data &&
                  finalCheck.data.rootHash !==
                    '11111111111111111111111111111111'
                ) {
                  if (timeoutId) {
                    clearTimeout(timeoutId);
                  }
                  // Just resolve - registration will happen after this
                  resolve();
                  return;
                }
              } catch (error) {
                console.warn(
                  'Final context check failed, but proceeding:',
                  error,
                );
              }

              if (timeoutId) {
                clearTimeout(timeoutId);
              }
              // Just resolve - registration will happen after this
              resolve();
              return;
            }
          }
        } catch (error) {
          console.error('Error checking sync status:', error);
        }

        timeoutId = setTimeout(checkSync, checkInterval);
        syncIntervalRef.current = timeoutId;
      };

      checkSync();
    });
  }, []);

  const joinContextWithInvitation = useCallback(async () => {
    if (hasAttemptedJoin.current) {
      return;
    }
    hasAttemptedJoin.current = true;

    try {
      let invitationPayload = extractInvitationFromUrl();
      if (!invitationPayload) {
        invitationPayload = getInvitationFromStorage();
      }

      if (!invitationPayload) {
        setErrorMessage('No invitation found');
        setStatus('error');
        hasAttemptedJoin.current = false;
        return;
      }

      if (extractInvitationFromUrl()) {
        saveInvitationToStorage(invitationPayload);
        window.history.replaceState(
          {},
          document.title,
          window.location.pathname,
        );
      }

      // Wait for app to be available, checking the ref which is kept in sync
      if (!appRef.current) {
        let waitAttempts = 0;
        const maxWaitAttempts = 20;
        while (!appRef.current && waitAttempts < maxWaitAttempts) {
          await new Promise((resolve) => setTimeout(resolve, 500));
          waitAttempts++;
        }

        if (!appRef.current) {
          setErrorMessage(
            'Application is still initializing. Please wait a moment and try again.',
          );
          setStatus('error');
          // Reset the flag so retry can work
          hasAttemptedJoin.current = false;
          return;
        }
      } else {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }

      // Use the ref value for the rest of the function to ensure we have the latest
      const currentApp = appRef.current;

      const identityResponse: ResponseData<NodeIdentity> = await apiClient
        .node()
        .createNewIdentity();

      if (identityResponse.error || !identityResponse.data) {
        setErrorMessage(
          identityResponse.error?.message ||
            'Failed to create identity for invitation',
        );
        setStatus('error');
        hasAttemptedJoin.current = false;
        return;
      }

      const executorPublicKey = identityResponse.data.publicKey;

      const joinResponse: ResponseData<JoinContextResponse> = await apiClient
        .node()
        .joinContextByOpenInvitation(
          JSON.parse(invitationPayload.trim()) as SignedOpenInvitation,
          executorPublicKey,
        );

      if (joinResponse.error || !joinResponse.data) {
        setErrorMessage(
          joinResponse.error?.message || 'Failed to join context',
        );
        setStatus('error');
        hasAttemptedJoin.current = false;
        return;
      }

      const verifyContextResponse = await apiClient
        .node()
        .getContext(joinResponse.data.contextId);

      if (verifyContextResponse.error || !verifyContextResponse.data) {
        setErrorMessage('Failed to verify context');
        setStatus('error');
        hasAttemptedJoin.current = false;
        return;
      }
      const memberPublicKey = joinResponse.data.memberPublicKey;

      localStorage.setItem(
        'new-context-identity',
        JSON.stringify(identityResponse.data),
      );
      localStorage.setItem('agreementContextID', joinResponse.data.contextId);
      localStorage.setItem('agreementContextUserID', memberPublicKey);

      setContextId(joinResponse.data.contextId);
      setExecutorPublicKey(memberPublicKey);

      setStatus('syncing');
      await waitForContextSync(joinResponse.data.contextId);

      // Import necessary modules
      const { ClientApiDataSource } = await import(
        '../api/dataSource/ClientApiDataSource'
      );
      const { DefaultContextService } = await import(
        '../api/defaultContextService'
      );

      const clientApi = new ClientApiDataSource(currentApp);

      // Wait for RPC to be ready by testing with a read call
      // The state might not be ready even after rootHash changes
      let rpcReady = false;
      let rpcAttempts = 0;
      const maxRpcAttempts = 10;

      console.log('Waiting for RPC to be ready...');
      while (!rpcReady && rpcAttempts < maxRpcAttempts) {
        rpcAttempts++;
        try {
          // Try a simple read call to verify RPC is working
          const testResponse = await clientApi.getContextDetails(
            joinResponse.data.contextId,
            joinResponse.data.contextId,
            memberPublicKey,
          );

          if (testResponse.error?.message?.includes('Uninitialized')) {
            console.log(
              `RPC not ready yet (attempt ${rpcAttempts}/${maxRpcAttempts}), waiting...`,
            );
            await new Promise((resolve) => setTimeout(resolve, 3000));
          } else {
            console.log('RPC is ready!');
            rpcReady = true;
          }
        } catch (error) {
          console.log(
            `RPC test failed (attempt ${rpcAttempts}/${maxRpcAttempts}):`,
            error,
          );
          await new Promise((resolve) => setTimeout(resolve, 3000));
        }
      }

      if (!rpcReady) {
        console.warn(
          'RPC still not ready after max attempts, proceeding anyway...',
        );
      }

      setStatus('registering');

      // Step 1: Register self as participant in the shared context
      // This is required for newly joined users via open invitation
      // Use the memberPublicKey from the join response
      // Retry logic for "Uninitialized" errors which can occur if state isn't fully ready
      let registerSuccess = false;
      let registerAttempts = 0;
      const maxRegisterAttempts = 5;

      while (!registerSuccess && registerAttempts < maxRegisterAttempts) {
        registerAttempts++;
        try {
          const registerResponse = await clientApi.registerSelfAsParticipant(
            joinResponse.data.contextId,
            memberPublicKey,
          );

          if (registerResponse.error) {
            const errorMessage = registerResponse.error.message || '';

            // If already registered, that's fine - continue
            if (errorMessage.includes('Already registered')) {
              console.log('Already registered as participant');
              registerSuccess = true;
            } else if (
              errorMessage.includes('Uninitialized') &&
              registerAttempts < maxRegisterAttempts
            ) {
              // State not ready yet, wait and retry
              console.log(
                `Register attempt ${registerAttempts} failed with Uninitialized, retrying...`,
              );
              await new Promise((resolve) => setTimeout(resolve, 2000));
            } else {
              console.warn(
                'Failed to register as participant:',
                registerResponse.error,
              );
              registerSuccess = true; // Don't block the flow
            }
          } else {
            console.log('Successfully registered as participant in context');
            registerSuccess = true;
          }
        } catch (error) {
          console.warn(
            `Error registering as participant (attempt ${registerAttempts}):`,
            error,
          );
          if (registerAttempts < maxRegisterAttempts) {
            await new Promise((resolve) => setTimeout(resolve, 2000));
          } else {
            registerSuccess = true; // Don't block the flow
          }
        }
      }

      // Step 2: Fetch context details to get the actual name
      // Retry logic for "Uninitialized" errors
      let contextName = 'Agreement'; // Default fallback
      let detailsAttempts = 0;
      const maxDetailsAttempts = 3;

      while (detailsAttempts < maxDetailsAttempts) {
        detailsAttempts++;
        try {
          const contextDetailsResponse = await clientApi.getContextDetails(
            joinResponse.data.contextId,
            joinResponse.data.contextId,
            memberPublicKey,
          );

          if (contextDetailsResponse.data?.context_name) {
            contextName = contextDetailsResponse.data.context_name;
            console.log('Fetched context name from state:', contextName);
            break;
          } else if (
            contextDetailsResponse.error?.message?.includes('Uninitialized') &&
            detailsAttempts < maxDetailsAttempts
          ) {
            console.log(
              `getContextDetails attempt ${detailsAttempts} failed with Uninitialized, retrying...`,
            );
            await new Promise((resolve) => setTimeout(resolve, 2000));
          } else {
            console.warn('Context name not found in response, using default');
            break;
          }
        } catch (error) {
          console.warn(
            `Failed to fetch context name (attempt ${detailsAttempts}):`,
            error,
          );
          if (detailsAttempts < maxDetailsAttempts) {
            await new Promise((resolve) => setTimeout(resolve, 2000));
          }
        }
      }

      // Step 3: Register the context in the user's private context
      if (currentApp) {
        const defaultContextService =
          DefaultContextService.getInstance(currentApp);
        const ensureResult = await defaultContextService.ensureDefaultContext();

        if (ensureResult.success) {
          const joinSharedResponse = await clientApi.joinSharedContext(
            joinResponse.data.contextId,
            memberPublicKey,
            contextName,
          );

          if (joinSharedResponse.error) {
            console.error(
              'Failed to join shared context:',
              joinSharedResponse.error,
            );
          } else {
            console.log(
              'Successfully registered context in private context with name:',
              contextName,
            );
          }
        }
      }

      // All registration complete - clear invitation and close popup
      console.log('All registration steps complete, closing popup');
      clearInvitationFromStorage();
      onSuccess();
    } catch (error) {
      console.error('Invitation join error:', error);
      setErrorMessage(
        error instanceof Error ? error.message : 'An unexpected error occurred',
      );
      setStatus('error');
      // Reset the flag on error so retry can work
      hasAttemptedJoin.current = false;
    }
  }, [waitForContextSync, onSuccess]);

  useEffect(() => {
    joinContextWithInvitation();
    return () => {
      if (syncIntervalRef.current) {
        clearTimeout(syncIntervalRef.current);
      }
    };
  }, [joinContextWithInvitation]);

  const handleRetry = () => {
    hasAttemptedJoin.current = false;
    setErrorMessage('');
    setStatus('joining');
    joinContextWithInvitation();
  };

  const handleCancel = () => {
    clearInvitationFromStorage();
    onError();
  };

  return (
    <Overlay>
      <PopupContainer>
        {status === 'joining' && (
          <>
            <Title>Joining the invitation...</Title>
            <Message type="info">
              Please wait while we process your invitation.
            </Message>
          </>
        )}

        {status === 'syncing' && (
          <>
            <Title>Syncing context...</Title>
            <Message type="info">
              Please wait while the context state is syncing. This may take a
              moment.
            </Message>
          </>
        )}

        {status === 'registering' && (
          <>
            <Title>Registering...</Title>
            <Message type="info">
              Registering you as a participant. Almost done!
            </Message>
          </>
        )}

        {status === 'error' && (
          <>
            <Title>Context Join Failed</Title>
            <Message type="error">{errorMessage}</Message>
            <ButtonGroup>
              <Button
                onClick={handleRetry}
                variant="primary"
                style={{ flex: 1 }}
              >
                Retry Again
              </Button>
              <Button
                onClick={handleCancel}
                variant="secondary"
                style={{ flex: 1 }}
              >
                Cancel
              </Button>
            </ButtonGroup>
          </>
        )}
      </PopupContainer>
    </Overlay>
  );
}
