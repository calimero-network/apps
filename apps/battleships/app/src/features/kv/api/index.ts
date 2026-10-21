import { LobbyClient } from '../../../generated/lobby/LobbyClient';
import { GameClient } from '../../../generated/game/GameClient';
import type { ExecuteTransport } from '@calimero-network/mero-js';

/** What the generated clients execute through: `useMero().mero` on either session. */
type Transport = ExecuteTransport | { readonly rpc: ExecuteTransport };

import { resolveAppContext } from './context';
import type { AppContext, ContextAdmin, ContextRole, ResolveAppContextOptions } from './context';

export { LobbyClient, GameClient };
export type { AppContext, ContextAdmin, ContextRole };

export type ApiResult<T> =
  | { data: T; error: null }
  | { data: null; error: { code: number; message: string } };

export function isOk<T>(
  result: ApiResult<T>,
): result is { data: T; error: null } {
  return result.error === null;
}

export interface CreateKvClientOptions {
  contextId?: string | null;
  contextIdentity?: string | null;
  role?: ContextRole | null;
  applicationId?: string | null;
}

export async function createLobbyClient(
  mero: Transport,
  admin: ContextAdmin,
  options: CreateKvClientOptions = {},
): Promise<{ client: LobbyClient; context: AppContext }> {
  const resolveOptions: ResolveAppContextOptions = {
    targetContextId: options.contextId,
    contextIdentity: options.contextIdentity,
    role: options.role,
    applicationId: options.applicationId,
  };

  const context = await resolveAppContext(admin, resolveOptions);

  return {
    client: new LobbyClient(mero, context.contextId),
    context,
  };
}

export async function createGameClient(
  mero: Transport,
  admin: ContextAdmin,
  options: CreateKvClientOptions = {},
): Promise<{ client: GameClient; context: AppContext }> {
  const resolveOptions: ResolveAppContextOptions = {
    targetContextId: options.contextId,
    contextIdentity: options.contextIdentity,
    role: options.role,
    applicationId: options.applicationId,
  };

  const context = await resolveAppContext(admin, resolveOptions);

  return {
    client: new GameClient(mero, context.contextId),
    context,
  };
}

// Backward compat — createKvClient creates a LobbyClient by default
export async function createKvClient(
  mero: Transport,
  admin: ContextAdmin,
  options: CreateKvClientOptions = {},
): Promise<{ client: LobbyClient; context: AppContext }> {
  return createLobbyClient(mero, admin, options);
}
