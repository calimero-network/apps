// ── Redeeming an invitation, whichever kind it is ────────────────────────────
//
// One routine, called from two places: the app-level popup that fires when an
// invitation link is opened, and the "paste what you were sent" box on the
// dashboard. They used to be two near-identical 150-line blocks that had already
// drifted — the popup read the agreement's real name out of the contract and the
// dashboard asked the joiner to type one — which is how the same invitation
// produced two different names depending on which door you came through.
//
// What an invitation grants, and what it does NOT:
//
//   An invitation is membership of the agreement's context. That is all it is.
//   It carries no document, no signature and no key material, and redeeming one
//   records the joiner as a participant with SIGN permission for themselves and
//   nobody else (`register_self_as_participant` derives the identity from
//   `env::account_id()` inside the contract, so nothing here can name a
//   different person). The `contextName` travelling alongside the invitation is
//   a display string outside the signature and is never trusted over the
//   contract's own replicated `context_name`.

import {
  apiClient,
  setContextId,
  setExecutorPublicKey,
  type ResponseData,
} from '@calimero-network/calimero-client';
import type {
  JoinContextResponse,
  NodeIdentity,
  SignedOpenInvitation,
} from '@calimero-network/calimero-client/lib/api/nodeApi';
import { ClientApiDataSource } from './dataSource/ClientApiDataSource';
import { ContextApiDataSource } from './dataSource/nodeApiDataSource';
import { DefaultContextService } from './defaultContextService';
import {
  contextIdOfInvite,
  decodeInvite,
  type MeroSignInvitePayload,
} from '../lib/inviteCodec';
import { invitationFromRaw } from '../lib/inviteLink';
import { resolveAgreementName } from '../lib/agreementName';

/**
 * The `app` handle `useCalimero()` returns.
 *
 * The data-source layer this app is built on takes it as `any` throughout, so
 * there is no honest type to narrow to here; naming the alias at least says that
 * the looseness is inherited rather than chosen.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type CalimeroAppLike = any;

/** Coarse progress, so the popup can say which slow step it is on. */
export type RedeemStage = 'joining' | 'syncing' | 'registering' | 'naming';

export interface RedeemResult {
  contextId: string;
  memberPublicKey: string;
  /** The agreement name as every node will see it. */
  name: string;
}

const UNINITIALIZED = 'Uninitialized';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isSyncing(message: string | undefined): boolean {
  if (!message) return false;
  return (
    message.includes(UNINITIALIZED) ||
    // `getErrorMessage` in ClientApiDataSource already rewrites the node's
    // "Uninitialized" into this sentence; match both spellings or every retry
    // loop below gives up on its first attempt.
    message.includes('Syncing state')
  );
}

/**
 * Parse a link / code / pasted payload into something redeemable.
 *
 * Exported because both entry points want to validate before they show a
 * "joining…" spinner, and because it is the seam the tests use.
 */
export function parseInvitation(raw: string): MeroSignInvitePayload | null {
  const code = invitationFromRaw(raw);
  if (!code) return null;
  return decodeInvite(code);
}

/**
 * Wait until the joined context has state to answer with.
 *
 * A freshly joined context starts at the all-ones root hash and answers every
 * contract call with "Uninitialized" until the first sync lands. Rather than
 * polling `getContext().rootHash` — which this app used to do, and could not
 * read, because `apiClient` hands back the node's raw body and the root hash is
 * one level deeper than the call site assumed, so the check passed instantly and
 * always — this asks the contract the question we actually care about: can you
 * tell me about this context yet?
 */
async function waitForContextState(
  clientApi: ClientApiDataSource,
  contextId: string,
  memberPublicKey: string,
): Promise<string | undefined> {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    try {
      const details = await clientApi.getContextDetails(
        contextId,
        contextId,
        memberPublicKey,
      );
      if (details.data?.context_name !== undefined) {
        return details.data.context_name;
      }
      if (!isSyncing(details.error?.message)) {
        // A real error (or an answer with no name in it). Either way, waiting
        // longer will not change it.
        return undefined;
      }
    } catch {
      /* transport hiccup — treat as not-ready and retry */
    }
    await sleep(attempt < 4 ? 1000 : 2500);
  }
  return undefined;
}

/**
 * Register the joiner as a participant of the shared context.
 *
 * Best-effort on purpose: "Already registered as participant" is a success, and
 * a persistent failure must not strand somebody outside an agreement they were
 * invited to — they are already a context member at that point and the contract
 * will accept the registration on any later call.
 */
async function registerSelf(
  clientApi: ClientApiDataSource,
  contextId: string,
  memberPublicKey: string,
): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const res = await clientApi.registerSelfAsParticipant(
        contextId,
        memberPublicKey,
      );
      if (!res.error) return;
      const message = res.error.message || '';
      if (message.includes('Already registered')) return;
      if (!isSyncing(message)) {
        console.warn('Failed to register as participant:', res.error);
        return;
      }
    } catch (error) {
      console.warn('Error registering as participant:', error);
    }
    await sleep(2000);
  }
}

async function joinByOpenInvitation(
  invitation: SignedOpenInvitation,
): Promise<JoinContextResponse> {
  const identity: ResponseData<NodeIdentity> = await apiClient
    .node()
    .createNewIdentity();
  if (identity.error || !identity.data) {
    throw new Error(
      identity.error?.message || 'Failed to create an identity for this node',
    );
  }

  const joined: ResponseData<JoinContextResponse> = await apiClient
    .node()
    .joinContextByOpenInvitation(invitation, identity.data.publicKey);

  if (joined.error || !joined.data) {
    throw new Error(joined.error?.message || 'Failed to join the agreement');
  }

  // Kept for the screens that still read the joining identity back out of
  // storage; the join response is the source of truth for everything here.
  try {
    localStorage.setItem('new-context-identity', JSON.stringify(identity.data));
  } catch {
    /* storage blocked — not fatal, the join already happened */
  }

  return joined.data;
}

async function joinByTargetedPayload(
  nodeApi: ContextApiDataSource,
  payload: string,
): Promise<JoinContextResponse> {
  const joined = await nodeApi.joinContext({ invitationPayload: payload });
  if (joined.error || !joined.data) {
    throw new Error(joined.error?.message || 'Failed to join the agreement');
  }
  return joined.data as JoinContextResponse;
}

/**
 * Redeem an invitation end to end and return the agreement as this node will
 * now show it.
 *
 * Throws with a message fit for a user on any step that cannot be recovered
 * from; the recoverable steps (participant registration, the private-context
 * bookkeeping) log and continue.
 */
export async function redeemInvitation(
  raw: string,
  app: CalimeroAppLike,
  onStage?: (stage: RedeemStage) => void,
): Promise<RedeemResult> {
  const parsed = parseInvitation(raw);
  if (!parsed) {
    throw new Error(
      'That does not look like a MeroSign invitation. Paste the link or the code you were sent.',
    );
  }

  const clientApi = new ClientApiDataSource(app);
  const nodeApi = new ContextApiDataSource(app);

  onStage?.('joining');
  const joined =
    parsed.kind === 'open'
      ? await joinByOpenInvitation(
          parsed.invitation as unknown as SignedOpenInvitation,
        )
      : await joinByTargetedPayload(nodeApi, parsed.targetedPayload as string);

  const contextId = joined.contextId;
  const memberPublicKey = joined.memberPublicKey;
  if (!contextId || !memberPublicKey) {
    throw new Error(
      'The node accepted the invitation but did not say which context it joined.',
    );
  }

  // An open invitation names its context inside the SIGNED body. If the node
  // joined a different one, something is wrong with either the node or the code
  // and we would rather say so than quietly open a stranger's agreement.
  if (parsed.kind === 'open') {
    const signedContextId = contextIdOfInvite(parsed);
    if (signedContextId && signedContextId !== contextId) {
      throw new Error(
        'This invitation is for a different agreement than the one that was joined.',
      );
    }
  }

  localStorage.setItem('agreementContextID', contextId);
  localStorage.setItem('agreementContextUserID', memberPublicKey);
  setContextId(contextId);
  setExecutorPublicKey(memberPublicKey);

  onStage?.('syncing');
  const contractName = await waitForContextState(
    clientApi,
    contextId,
    memberPublicKey,
  );

  onStage?.('registering');
  await registerSelf(clientApi, contextId, memberPublicKey);

  onStage?.('naming');
  // The contract's `context_name` is the value every node agrees on; the
  // invitation's is the inviter's own words and only stands in while the shared
  // context is still catching up.
  const name = resolveAgreementName({
    fromContract: contractName,
    fromInvitation: parsed.contextName,
    contextId,
  });

  // Record the agreement in this node's own private context, which is where the
  // dashboard's list comes from. Best-effort: "Already joined this context" is
  // the normal answer on a second redemption of the same link.
  try {
    const defaultContextService = DefaultContextService.getInstance(app);
    const ensured = await defaultContextService.ensureDefaultContext();
    if (ensured.success) {
      const res = await clientApi.joinSharedContext(
        contextId,
        memberPublicKey,
        name,
      );
      if (res.error && !res.error.message?.includes('Already joined')) {
        console.warn('Failed to record the agreement locally:', res.error);
      }
    } else {
      console.warn(
        'No private context to record the agreement in:',
        ensured.error,
      );
    }
  } catch (error) {
    console.warn('Failed to record the agreement locally:', error);
  }

  return { contextId, memberPublicKey, name };
}
