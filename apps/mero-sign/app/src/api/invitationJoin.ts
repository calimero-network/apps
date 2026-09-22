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
  adminApi,
  apiClient,
  setContextId,
  setExecutorPublicKey,
  type ResponseData,
} from '../lib/node';
import type {
  JoinContextResponse,
  JoinNamespaceResult,
  SignedOpenInvitation,
} from '../lib/node';
import { ClientApiDataSource } from './dataSource/ClientApiDataSource';
import { ContextApiDataSource } from './dataSource/nodeApiDataSource';
import { DefaultContextService } from './defaultContextService';
import {
  contextIdOfInvite,
  decodeInvite,
  namespaceIdOfInvite,
  type MeroSignInvitePayload,
} from '../lib/inviteCodec';
import { invitationFromRaw } from '../lib/inviteLink';
import { resolveAgreementName } from '../lib/agreementName';
import {
  enterAgreement,
  listAgreements,
  pickInvitedAgreement,
} from '../lib/agreements';
import { setActiveWorkspace } from '../lib/activeWorkspace';
import { markNamespaceJustJoined } from '@calimero-apps/join-sync';

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
export type RedeemStage =
  | 'joining'
  | 'entering'
  | 'syncing'
  | 'registering'
  | 'naming';

export interface RedeemResult {
  /** The workspace that was joined. Null for a legacy targeted invitation. */
  namespaceId: string | null;
  /**
   * The agreement that was entered, when the invitation resolved to exactly
   * one.
   *
   * ⚠️ NULLABLE, AND ROUTINELY NULL. An invitation grants membership of a
   * WORKSPACE; the agreements inside it are subgroups you enter afterwards. A
   * workspace with no agreement yet — invite the people first, draw up the
   * document second — is a valid thing to be invited to, and so is one with
   * several. Callers route to the workspace when this is null rather than to
   * `/agreements/undefined`.
   */
  contextId: string | null;
  memberPublicKey: string | null;
  /** The agreement name as every node will see it. Empty with no agreement. */
  name: string;
  /** The workspace's name, for the screen that lands on it. */
  workspaceName: string;
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

/**
 * Join the WORKSPACE an open invitation grants.
 *
 * ⚠️ NO IDENTITY IS MINTED FIRST. The previous version called
 * `createNewIdentity()` and passed the key as a second argument, which is how
 * the context-era API worked. `joinNamespace` mints the member identity itself
 * and returns it as `memberIdentity`; supplying one is at best ignored and the
 * pre-call was a round trip whose failure aborted a join that would have
 * succeeded.
 */
async function joinWorkspaceByInvitation(
  namespaceId: string,
  invitation: SignedOpenInvitation,
): Promise<JoinNamespaceResult> {
  const joined: ResponseData<JoinNamespaceResult> = await apiClient
    .node()
    .joinContextByOpenInvitation(namespaceId, invitation);

  if (joined.error || !joined.data) {
    throw new Error(joined.error?.message || 'Failed to join the workspace');
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
 * Redeem an invitation end to end and return where this node now stands.
 *
 * Throws with a message fit for a user on any step that cannot be recovered
 * from; the recoverable steps (participant registration, the private-context
 * bookkeeping) log and continue.
 *
 * ── The shape of this, since the workspace model ────────────────────────────
 *
 * An invitation grants membership of a WORKSPACE. That is one call, and it is
 * the only one that can fail in a way the person can do something about. What
 * follows — find the agreements, enter one, wait for it to sync, register as a
 * participant — is entering a subgroup, and every step of it is allowed to
 * come back empty without that being an error:
 *
 *   * no agreements yet → you are in the workspace, there is nothing to sign
 *   * several agreements → you are in the workspace, pick one
 *
 * Both land on the workspace screen. Only "the node refused the invitation" is
 * a failure.
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

  // ── A legacy targeted invitation ──────────────────────────────────────────
  //
  // Minted for one named key against a single context, by a build of this app
  // that predates workspaces. It still resolves to a context directly, so it
  // keeps its own short path rather than being forced through a workspace it
  // never had.
  if (parsed.kind !== 'open') {
    const joined = await joinByTargetedPayload(
      nodeApi,
      parsed.targetedPayload as string,
    );
    if (!joined.contextId || !joined.memberPublicKey) {
      throw new Error(
        'The node accepted the invitation but did not say which agreement it joined.',
      );
    }
    const name = await settleIntoAgreement(
      clientApi,
      app,
      joined.contextId,
      joined.memberPublicKey,
      parsed.contextName,
      onStage,
    );
    return {
      namespaceId: null,
      contextId: joined.contextId,
      memberPublicKey: joined.memberPublicKey,
      name,
      workspaceName: '',
    };
  }

  // ── An open invitation: the workspace, then an agreement in it ────────────
  //
  // ⚠️ The namespace comes out of the SIGNED body, never the envelope beside
  // it. `joinNamespace` takes it in the path, so a namespace id a sharer could
  // edit would be a namespace id that decides which workspace you are put in.
  const namespaceId = namespaceIdOfInvite(parsed);
  if (!namespaceId) {
    throw new Error(
      'This invitation does not name a workspace. It may have been minted by ' +
        'a version of Mero Sign from before workspaces — ask for a new link.',
    );
  }

  const joined = await joinWorkspaceByInvitation(
    namespaceId,
    parsed.invitation as unknown as SignedOpenInvitation,
  );

  // The node's own answer, not the id we asked with: if they ever disagree the
  // node is right about what it joined.
  const workspaceId = joined.namespaceId || namespaceId;
  setActiveWorkspace(workspaceId);
  // Joined; the workspace's agreements have not replicated yet. Flagged so the
  // list the joiner lands on says "syncing" rather than showing the empty state
  // it is otherwise indistinguishable from.
  markNamespaceJustJoined(workspaceId);
  const workspaceName = (joined.groupName || parsed.workspaceName || '').trim();

  onStage?.('entering');
  const admin = adminApi();
  const agreements = await listAgreements(admin, workspaceId).catch(() => []);
  const target = pickInvitedAgreement(agreements, contextIdOfInvite(parsed));

  if (!target || !target.contextId) {
    // In the workspace, not in an agreement. A real and unremarkable state.
    return {
      namespaceId: workspaceId,
      contextId: null,
      memberPublicKey: null,
      name: '',
      workspaceName,
    };
  }

  const identity = await enterAgreement(admin, {
    namespaceId: workspaceId,
    agreementId: target.agreementId,
    contextId: target.contextId,
  });

  const name = await settleIntoAgreement(
    clientApi,
    app,
    target.contextId,
    identity,
    parsed.contextName ?? target.name,
    onStage,
  );

  return {
    namespaceId: workspaceId,
    contextId: target.contextId,
    memberPublicKey: identity,
    name,
    workspaceName,
  };
}

/**
 * Everything that happens once this node holds an identity in an agreement:
 * make it the current one, wait for state, register as a participant, settle
 * on the name, and record it locally.
 *
 * Extracted because the open and targeted paths reach this point by different
 * routes and used to carry two copies of it, which is how they drifted before.
 */
async function settleIntoAgreement(
  clientApi: ClientApiDataSource,
  app: CalimeroAppLike,
  contextId: string,
  memberPublicKey: string,
  nameHint: string | undefined,
  onStage?: (stage: RedeemStage) => void,
): Promise<string> {
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
    fromInvitation: nameHint,
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

  return name;
}
