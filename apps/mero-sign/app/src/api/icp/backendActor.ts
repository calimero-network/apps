import { Actor, HttpAgent } from '@dfinity/agent';
import { AuthClient } from '@dfinity/auth-client';
import { idlFactory } from '../../../../merodocs_registry/src/declarations/backend/backend.did.js';
import { validateEnvironment, getNetworkConfig } from './utils';

// Validate environment on import
validateEnvironment();

const { network, backendCanisterId, isMainnet, hostUrl, identityProvider } =
  getNetworkConfig();

export async function createBackendActor(identity?: any) {
  const agent = await HttpAgent.create({
    identity,
    host: hostUrl,
  });

  if (network === 'local') {
    try {
      await agent.fetchRootKey();
    } catch (err) {
      console.warn(
        ' Unable to fetch root key. Check if local replica is running:',
        err,
      );
    }
  }

  if (!backendCanisterId) {
    throw new Error(`Missing canister ID for network: ${network}`);
  }

  return Actor.createActor(idlFactory, {
    agent,
    canisterId: backendCanisterId,
  });
}

let authClient: AuthClient | null = null;

export async function getAuthClient(): Promise<AuthClient> {
  if (!authClient) {
    authClient = await AuthClient.create();
  }
  return authClient;
}

export async function loginWithInternetIdentity(): Promise<boolean> {
  const client = await getAuthClient();

  return new Promise((resolve) => {
    client.login({
      identityProvider: identityProvider,
      onSuccess: () => {
        resolve(true);
      },
      onError: (error) => {
        console.error('❌ Internet Identity login failed:', error);
        resolve(false);
      },
    });
  });
}

export async function logout(): Promise<void> {
  const client = await getAuthClient();
  await client.logout();
}

export async function isAuthenticated(): Promise<boolean> {
  const client = await getAuthClient();
  return await client.isAuthenticated();
}

export async function getIdentity() {
  const client = await getAuthClient();
  return client.getIdentity();
}
