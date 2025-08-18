import { Actor, HttpAgent } from '@dfinity/agent';
import { idlFactory } from '../../../../merodocs_registry/src/declarations/backend/backend.did.js';

// Hardcoded canister and principal for local development
const network = import.meta.env.VITE_DFX_NETWORK || 'local';
const LOCAL_CANISTER_ID =
  import.meta.env.VITE_BACKEND_CANISTER_ID || 'uxrrr-q7777-77774-qaaaq-cai';
const LOCAL_PRINCIPAL_ID =
  import.meta.env.VITE_LOCAL_PRINCIPAL_ID || 'uxrrr-q7777-77774-qaaaq-cai';

const backendCanisterId =
  network === 'local'
    ? LOCAL_CANISTER_ID
    : import.meta.env.VITE_BACKEND_CANISTER_ID;

export async function createBackendActor(identity?: any) {
  // For local development, using hardcoded principal and skip identity from mainnet
  const agent = await HttpAgent.create({
    identity: network === 'local' ? undefined : identity,
    host: network === 'local' ? 'http://127.0.0.1:4943' : 'https://icp-api.io',
  });

  // Only fetching root key in local development
  if (network === 'local') {
    await agent.fetchRootKey().catch((err) => {
      console.warn('Unable to fetch root key. Is your local replica running?');
      console.error(err);
    });
  }

  // For local,optionally pass the principal to the actor if needed
  return Actor.createActor(idlFactory, {
    agent,
    canisterId: backendCanisterId,
    ...(network === 'local' && { principal: LOCAL_PRINCIPAL_ID }),
  });
}
