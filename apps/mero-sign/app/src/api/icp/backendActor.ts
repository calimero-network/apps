import { Actor, HttpAgent } from '@dfinity/agent';
import { Principal } from '@dfinity/principal';
import { AuthClient } from '@dfinity/auth-client';
import { idlFactory as merodocs_registry_idlFactory } from '../../../../canisters/src/declarations/merodocs_registry/merodocs_registry.did.js';
import { idlFactory as llm_chatbot_idlFactory } from '../../../../canisters/src/declarations/llm_chatbot/llm_chatbot.did.js';
import { validateEnvironment, getNetworkConfig } from './utils';

validateEnvironment();

const { network, hostUrl, identityProvider } = getNetworkConfig();

const LLM_CHATBOT_CANISTER_ID =
  import.meta.env.VITE_LLM_CHATBOT_CANISTER_ID || 'ulvla-h7777-77774-qaacq-cai';
const MERODOCS_REGISTRY_CANISTER_ID =
  import.meta.env.VITE_MERODOCS_REGISTRY_CANISTER_ID ||
  'ucwa4-rx777-77774-qaada-cai';

async function createAgent(identity?: any): Promise<HttpAgent> {
  const agent = await HttpAgent.create({
    identity,
    host: hostUrl,
  });

  if (network === 'local') {
    try {
      await agent.fetchRootKey();
    } catch (err) {
      console.warn(
        'Unable to fetch root key. Check if local replica is running:',
        err,
      );
    }
  }

  return agent;
}

function validateCanisterId(canisterId: string, canisterName: string): void {
  try {
    Principal.fromText(canisterId);
  } catch (err) {
    console.error(`Invalid canister ID for ${canisterName}:`, canisterId);
    throw new Error(
      `Invalid canister ID for ${canisterName} on network "${network}": ${canisterId}`,
    );
  }
}

export async function createMeroDocsRegistryActor(identity?: any) {
  const agent = await createAgent(identity);
  validateCanisterId(MERODOCS_REGISTRY_CANISTER_ID, 'merodocs_registry');

  return Actor.createActor(merodocs_registry_idlFactory, {
    agent,
    canisterId: MERODOCS_REGISTRY_CANISTER_ID,
  });
}

export async function createLLMChatbotActor(identity?: any) {
  const agent = await createAgent(identity);
  validateCanisterId(LLM_CHATBOT_CANISTER_ID, 'llm_chatbot');

  return Actor.createActor(llm_chatbot_idlFactory, {
    agent,
    canisterId: LLM_CHATBOT_CANISTER_ID,
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
        console.error('Internet Identity login failed:', error);
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
