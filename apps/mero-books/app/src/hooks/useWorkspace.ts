/**
 * useWorkspace - the single owner of workspace resolution.
 *
 * Namespace/organisation model:
 *  - A namespace is a team workspace. It is created or joined explicitly
 *    (no silent auto-create). `activeNs` is persisted in localStorage.
 *  - A context inside the namespace is ONE organisation. Organisations are added explicitly
 *    (name + currency); `activeOrganisation` (a contextId) is persisted per
 *    namespace and feeds every accounting view.
 *  - Every human-readable NAME lives somewhere replicated, because a name only
 *    one node can read is worse than no name at all: the creator sees "Platform
 *    team" and everyone they invite sees `20150f8a`.
 *      * workspace name -> `createNamespace({name})` + the group metadata record
 *        it is served from, and `groupAlias` inside the invitation payload so
 *        `joinNamespace({groupName})` can record it at join time;
 *      * organisation name      -> the context metadata record (`setContextMetadata`),
 *        not just `createContext({name})`, which is a label local to the node
 *        that created it;
 *      * people names   -> namespace member metadata (`setMemberMetadata`).
 *  - Desktop SSO: when the auth callback carries a contextId + identity, we
 *    treat that context as the active organisation and resolve its namespace, skipping
 *    the pickers entirely.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  useMero,
  useNamespacesForApplication,
  useCreateNamespaceInvitation,
  useGroupContexts,
  useGroupMembers,
  useNodeIdentity,
  useSetMemberMetadata,
  type Namespace,
} from '@calimero-network/mero-react';
import { useSubscription } from '@calimero-network/mero-react';
import { useStreamReconnect } from './useStreamReconnect';
import { PRIMARY_SERVICE } from '../config';
import { buildInvitePayload } from '../utils/invitePayload';
import { redeemInviteCode } from '../utils/redeemInvite';
import { createWorkspaceContext, foundWorkspace, publishContextName } from '../utils/workspaceOps';
import { BooksClient } from '../generated/BooksClient';
import { useApplicationId } from './useApplicationId';
import { useMemberRoles, type UseMemberRolesReturn } from './useMemberRoles';
import { buildAliasMap } from './useAliases';
import {
  readActiveNs,
  writeActiveNs,
  dropLegacyActiveNs,
  readActiveOrganisation,
  writeActiveOrganisation,
  clearPersistedWorkspace,
} from './workspacePersistence';
import { markNamespaceJustJoined, useJoinSync } from '@calimero-apps/join-sync';
import type { RedeemOutcome } from '@calimero-apps/invite';

export interface OrganisationEntry {
  contextId: string;
  /** Display name (context label) or a truncated id fallback. */
  name: string;
}

export interface CreateWorkspaceResult {
  /** The new namespace, or null when creation failed (`createNamespaceError` says why). */
  namespaceId: string | null;
  /**
   * Set when the workspace was created but is not hosted for invitations yet.
   * Only an ACCOUNT session sees this: founding through the relay admits a
   * fleet node for the namespace only for an account linked to a cloud user,
   * and without one an invitation minted here reaches nobody. Said at
   * creation, where the person can act on it, rather than as a failed invite
   * later.
   */
  haError: string | null;
}

export interface UseWorkspaceReturn {
  /**
   * A workspace joined this session whose organisations have not replicated yet. The
   * sidebar shows "syncing" instead of "No organisations yet", which is otherwise what
   * a brand-new member reads about a workspace full of them.
   */
  isSyncing: boolean;
  dismissSyncing: () => void;

  applicationId: string | null;
  /** True while the node is still being asked which installed app this is. */
  resolvingApplicationId: boolean;

  // namespaces
  namespaces: Namespace[];
  activeNs: string | null;
  /** True while an SSO-callback context's namespace is being resolved (a
   *  desktop handoff in flight) - the caller should hold off on onboarding
   *  UI until this settles, to avoid a flash into the picker. */
  resolvingCallback: boolean;
  selectNamespace: (id: string) => void;
  createNamespace: (name: string) => Promise<CreateWorkspaceResult>;
  createNamespaceLoading: boolean;
  createNamespaceError: Error | null;
  /** Redeems an invite code; never throws for an ordinary failure. */
  join: (code: string) => Promise<RedeemOutcome>;
  /** Mints an invitation and returns the JSON payload to wrap in a share link. */
  invite: () => Promise<string>;
  inviteLoading: boolean;

  // organisations (contexts inside the active namespace)
  organisations: OrganisationEntry[];
  activeOrganisation: string | null;
  selectOrganisation: (contextId: string) => void;
  addOrganisation: (name: string, currency: string) => Promise<string | null>;
  addOrganisationLoading: boolean;
  addOrganisationError: Error | null;
  organisationsLoading: boolean;

  // people (namespace members) + identity
  contextId: string | null;
  executorPublicKey: string | null;
  selfIdentity: string | null;
  members: string[];
  memberNames: Map<string, string>;
  /** Namespace roles + capabilities, keyed by ACCOUNT. See utils/roles. */
  roles: UseMemberRolesReturn;
  membersLoading: boolean;
  membersLoaded: boolean;
  setMemberName: (name: string) => Promise<void>;
  refetchMembers: () => Promise<void>;

  // status
  ready: boolean;
  loading: boolean;
  error: Error | null;
  clearPersisted: () => void;
}

export function useWorkspace(): UseWorkspaceReturn {
  // `mero` is the raw client and stays what the CONTRACT is called through
  // (`BooksClient(mero, ...)` is `mero.rpc`). Every admin call goes through
  // `admin`, the session-aware one (apps#348): the node's own client on a node
  // login, and on an account the account admin. On a delegated session
  // `mero.admin` is the relay's node route under the account's token, which
  // answered 403 to createNamespace, setGroupMetadata, setDefaultCapabilities,
  // createContext, setContextMetadata and joinNamespace on prod.
  const {
    mero,
    admin,
    isDelegated,
    applicationId: authApplicationId,
    contextId: callbackContextId,
    contextIdentity: callbackContextIdentity,
  } = useMero();
  // Which installed application IS this app: asked of the node and matched by
  // the bundle's `package` (see utils/appId). The session's id and a baked
  // `VITE_APPLICATION_ID` both describe how you ARRIVED, and on a shared origin
  // the session's belongs to whichever mero app logged in last — every namespace
  // read is scoped by it, so the workspace switcher then lists the other app's
  // workspaces while looking like it ignores the filter.
  //
  // The session id remains as a fallback for the one case the node cannot
  // answer: this app is not installed there under its package (a raw-wasm dev
  // install). That is strictly the old behaviour, and only where the old
  // behaviour was all there was.
  const { appId: nodeApplicationId, resolving: resolvingApplicationId } = useApplicationId();
  // Null while the node is still answering, NOT the session id. Scoping the
  // namespace list to a possibly-wrong id for one render is how a stale pick
  // gets auto-selected and then persisted; `resolvingApplicationId` lets the
  // caller hold the onboarding pane back for that window instead.
  const applicationId = resolvingApplicationId
    ? null
    : nodeApplicationId || authApplicationId || null;

  const { namespaces, loading: nsLoading, refetch: refetchNamespaces } =
    useNamespacesForApplication(applicationId);
  const { createNamespaceInvitation, loading: inviteLoading } = useCreateNamespaceInvitation();
  const { setMemberMetadata } = useSetMemberMetadata();

  // Drop the pre-versioning key on load; it is never read for a value, only
  // ever explicit selections (below) populate the versioned one.
  useEffect(() => { dropLegacyActiveNs(); }, []);

  // --- Active namespace (persisted; SSO callback context resolves its own) ---
  const [activeNs, setActiveNs] = useState<string | null>(() => readActiveNs());
  // True while an SSO-callback context is present but its namespace hasn't
  // resolved yet - the caller holds off on the empty-state picker during this
  // window so it doesn't flash in right before the desktop handoff lands.
  const [resolvingCallback, setResolvingCallback] = useState(() => !!callbackContextId);
  const userSelectedNs = useRef(false);

  // Resolve the namespace of the SSO callback context (a context's group IS
  // its namespace) so the desktop path skips the picker, and set it directly
  // - a separate "apply the resolved id" effect would let resolvingCallback
  // clear a render before activeNs catches up, flashing the empty state.
  useEffect(() => {
    if (!callbackContextId) { setResolvingCallback(false); return; }
    if (!admin) { setResolvingCallback(true); return; }
    let cancelled = false;
    setResolvingCallback(true);
    (async () => {
      try {
        const gid = await admin.getContextGroup(callbackContextId);
        if (!cancelled && gid) {
          // Explicit external handoff - persist it like any other selection.
          setActiveNs(gid);
          writeActiveNs(gid);
        }
      } catch {
        /* fall back to the discovered namespace list */
      } finally {
        if (!cancelled) setResolvingCallback(false);
      }
    })();
    return () => { cancelled = true; };
  }, [admin, callbackContextId]);

  // Pick a workspace to show on load. A valid persisted/current selection wins;
  // otherwise default to the first namespace (the list is already scoped to this
  // app, so this is a friendly cold-start default, not a stale cross-app entry).
  // The default is in-memory only - explicit switcher picks are what persist.
  useEffect(() => {
    if (userSelectedNs.current || resolvingCallback) return;
    if (namespaces.length === 0) {
      if (activeNs) { setActiveNs(null); writeActiveNs(null); }
      return;
    }
    if (activeNs && namespaces.some((n) => n.namespaceId === activeNs)) return;
    if (activeNs) writeActiveNs(null); // drop a stale persisted id before defaulting
    setActiveNs(namespaces[0].namespaceId);
  }, [namespaces, activeNs, resolvingCallback]);

  const selectNamespace = useCallback((id: string) => {
    userSelectedNs.current = true;
    setActiveNs(id);
    writeActiveNs(id);
  }, []);

  // --- Contexts (organisations) in the active namespace ---
  const { contexts, loading: organisationsLoading, refetch: refetchContexts } =
    useGroupContexts(activeNs);

  // Organisation names, from the REPLICATED context metadata record.
  //
  // `createContext({name})` gives the context a label on the CREATOR's node.
  // `listGroupContexts` then reports it there and the creator sees "mero-core"
  // — but an invited member's node never received that label, so the same organisation
  // rendered as `a1b2c3d4` for everyone else. `setContextMetadata` writes a CRDT
  // `MetadataRecord` against the managing group, which is the only place a name
  // written on one node is readable on another (this app ships the pattern as
  // `recipes/context-metadata`; `addOrganisation` now writes it).
  //
  // Keyed off the context IDS rather than the array, because `refetchContexts`
  // returns a fresh array on every poll and would otherwise re-fetch metadata
  // for every organisation on every refetch.
  const contextIdsKey = useMemo(
    () => contexts.map((c) => c.contextId).join(','),
    [contexts],
  );
  const [organisationMetaNames, setOrganisationMetaNames] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    const ids = contextIdsKey ? contextIdsKey.split(',') : [];
    if (!admin || !activeNs || ids.length === 0) { setOrganisationMetaNames(new Map()); return; }
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(
        ids.map(async (contextId) => {
          // An account's read of this record is refused by the relay today
          // (403, core#4483 fixes it); the catch keeps the local label.
          const rec = await admin
            .getContextMetadata(activeNs, contextId)
            .catch(() => null);
          const name = rec?.name?.trim();
          return name ? ([contextId, name] as const) : null;
        }),
      );
      if (cancelled) return;
      setOrganisationMetaNames(new Map(entries.filter((e): e is [string, string] => e !== null)));
    })();
    return () => { cancelled = true; };
  }, [admin, activeNs, contextIdsKey]);

  const organisations = useMemo<OrganisationEntry[]>(
    () =>
      contexts.map((c) => ({
        contextId: c.contextId,
        // Shared record first: the listing's `name` is this node's own label and
        // is absent on a node that did not create the context.
        name:
          organisationMetaNames.get(c.contextId) ||
          c.name?.trim() ||
          c.contextId.slice(0, 8),
      })),
    [contexts, organisationMetaNames],
  );

  // --- Active organisation (a contextId; persisted per namespace) ---
  const [activeOrganisation, setActiveOrganisation] = useState<string | null>(callbackContextId);
  const userSelectedOrganisation = useRef(false);

  // On a namespace switch, drop the previous namespace's organisation so a stale
  // contextId never leaks into the new namespace's views before its context
  // list resolves. The SSO path pins its own organisation and is exempt.
  useEffect(() => {
    if (callbackContextId) return;
    userSelectedOrganisation.current = false;
    setActiveOrganisation(null);
  }, [activeNs, callbackContextId]);

  // Prefer the SSO callback context; otherwise auto-select the persisted organisation
  // if it still exists, else the first organisation, else none (add-organisation empty state).
  useEffect(() => {
    if (callbackContextId) { setActiveOrganisation(callbackContextId); return; }
    if (!activeNs) { setActiveOrganisation(null); return; }
    if (userSelectedOrganisation.current && activeOrganisation && organisations.some((r) => r.contextId === activeOrganisation)) {
      return;
    }
    const persisted = readActiveOrganisation(activeNs);
    if (persisted && organisations.some((r) => r.contextId === persisted)) {
      setActiveOrganisation(persisted);
      return;
    }
    if (activeOrganisation && organisations.some((r) => r.contextId === activeOrganisation)) return;
    setActiveOrganisation(organisations[0]?.contextId ?? null);
  }, [callbackContextId, activeNs, organisations, activeOrganisation]);

  const selectOrganisation = useCallback((contextId: string) => {
    userSelectedOrganisation.current = true;
    setActiveOrganisation(contextId);
    if (activeNs) writeActiveOrganisation(activeNs, contextId);
  }, [activeNs]);

  // --- Executor identity for the active organisation context (for RPC) ---
  const [executorPublicKey, setExecutorPublicKey] = useState<string | null>(
    callbackContextIdentity,
  );
  useEffect(() => {
    if (callbackContextId && callbackContextIdentity) {
      setExecutorPublicKey(callbackContextIdentity);
    }
  }, [callbackContextId, callbackContextIdentity]);

  useEffect(() => {
    // `admin`, NOT `mero.admin`, for membership. `mero` is the raw client, and on
    // a delegated (account) session its transport is the relay: `mero.admin
    // .joinContext` is the relay's node route under the account's bearer token,
    // which does not carry it (403). `admin` is the session-aware one (apps#348):
    // the node's own client on a node login, and on an account the account
    // admin, whose `joinContext` joins the context's group as the account and
    // whose `getContextIdentitiesOwned` answers with the account itself.
    if (!mero || !admin || !activeOrganisation) { setExecutorPublicKey(callbackContextIdentity); return; }
    if (activeOrganisation === callbackContextId && callbackContextIdentity) return;
    let cancelled = false;
    setExecutorPublicKey(null);
    (async () => {
      try {
        const { identities } = await admin.getContextIdentitiesOwned(activeOrganisation);
        if (cancelled) return;
        if (identities.length > 0) { setExecutorPublicKey(identities[0]); return; }

        // No identity in this context yet. Auto-follow enrols a member in
        // contexts created AFTER they joined the namespace and in no others, so
        // every organisation that already existed when someone accepted an invitation
        // lands here — and without an executor key `ready` never flips, which
        // read as "the invite worked but the app is stuck loading forever".
        // Joining is an explicit call; membership in the namespace is what
        // authorises it.
        const joined = await admin.joinContext(activeOrganisation);
        if (!cancelled && joined?.memberPublicKey) {
          setExecutorPublicKey(joined.memberPublicKey);
        }
      } catch {
        /* leave null - useItems stays not-ready until an identity resolves */
      }
    })();
    return () => { cancelled = true; };
  }, [mero, admin, activeOrganisation, callbackContextId, callbackContextIdentity]);

  // --- Namespace members (people names live here) ---
  const {
    members: nsMembers,
    loading: membersLoading,
    refetch: refetchMembers,
  } = useGroupMembers(activeNs);
  // mero-react 6 dropped `selfIdentity` from useGroupMembers: identity belongs
  // to the node, not to one group, so it moved to its own endpoint. Use
  // `accountId` - core rc.21 rekeyed group members from a signing PublicKey to
  // an AccountId, and it is what listGroupMembers keys entries by, so it is
  // what locates us in `nsMembers` and what member-addressing endpoints take.
  // Both ids are 32 bytes and neither the client nor the node rejects the
  // wrong one (it just names a principal that exists nowhere), so this has to
  // be the account and never `publicKey`.
  const { identity: nodeIdentity, refetch: refetchNodeIdentity } = useNodeIdentity();
  // useNodeIdentity takes no key, so it resolves once on mount - and on the
  // onboarding path the node has no account yet at that point, because it is
  // creating/joining the namespace that enrols it. Re-ask on every namespace
  // change or `selfIdentity` stays null for the whole first session, which
  // silently hides the set-your-name gate (AliasGate returns null without an
  // identity) and leaves every member lookup unresolved.
  const refetchNodeIdentityRef = useRef(refetchNodeIdentity);
  refetchNodeIdentityRef.current = refetchNodeIdentity;
  useEffect(() => { if (activeNs) void refetchNodeIdentityRef.current(); }, [activeNs]);
  const selfIdentity = nodeIdentity?.accountId ?? null;
  const [membersLoaded, setMembersLoaded] = useState(false);
  useEffect(() => {
    setMembersLoaded(false);
  }, [activeNs]);
  useEffect(() => {
    if (!membersLoading) setMembersLoaded(true);
  }, [membersLoading]);

  // Live member list: the node emits a GroupMembership event on the namespace
  // group id when someone joins/leaves, so refetch instead of making the user
  // reload. Group events carry `groupId` (context events carry `contextId`).
  useSubscription(
    { groupIds: activeNs ? [activeNs] : [] },
    (ev) => { if ('groupId' in ev && ev.groupId) void refetchMembers(); },
  );
  // A join or leave during a stream outage sends no event we will ever see.
  useStreamReconnect(() => { if (activeNs) void refetchMembers(); });

  const members = useMemo(() => nsMembers.map((m) => m.identity), [nsMembers]);
  const memberNames = useMemo(
    () => buildAliasMap(nsMembers.filter((m) => m.name).map((m) => ({ name: m.name as string, value: m.identity }))),
    [nsMembers],
  );

  // Roles + capabilities for this workspace. Keyed by ACCOUNT throughout —
  // `nsMembers[].identity` and `selfIdentity` are accounts; `executorPublicKey`
  // is a context executor key and is NOT interchangeable with them.
  const roles = useMemberRoles(activeNs, nsMembers, selfIdentity, refetchMembers);

  const setMemberName = useCallback(
    async (name: string) => {
      if (!activeNs || !selfIdentity) throw new Error('Workspace not ready');
      await setMemberMetadata(activeNs, selfIdentity, { name: name.trim(), data: {} });
      await refetchMembers();
    },
    [activeNs, selfIdentity, setMemberMetadata, refetchMembers],
  );

  // --- Mutations: create namespace / add organisation / join / invite ---
  const [createNamespaceLoading, setCreateNamespaceLoading] = useState(false);
  const [createNamespaceError, setCreateNamespaceError] = useState<Error | null>(null);
  const createNamespace = useCallback(
    async (name: string): Promise<CreateWorkspaceResult> => {
      const failed: CreateWorkspaceResult = { namespaceId: null, haError: null };
      if (!admin || !applicationId) return failed;
      const trimmed = name.trim();
      if (!trimmed) {
        setCreateNamespaceError(new Error('Workspace name is required'));
        return failed;
      }
      setCreateNamespaceLoading(true);
      setCreateNamespaceError(null);
      try {
        // Create, pin the name, set the member baseline - through the session's
        // admin (utils/workspaceOps). For an account this founds the namespace
        // through the relay, under the app's registry package (the provider
        // already carries it), and reports `haError` when no fleet node could
        // be admitted for it.
        const { namespaceId, haError } = await foundWorkspace(admin, {
          applicationId,
          name: trimmed,
        });
        await refetchNamespaces();
        selectNamespace(namespaceId);
        return { namespaceId, haError };
      } catch (err) {
        setCreateNamespaceError(err instanceof Error ? err : new Error(String(err)));
        return failed;
      } finally {
        setCreateNamespaceLoading(false);
      }
    },
    [admin, applicationId, refetchNamespaces, selectNamespace],
  );

  const [addOrganisationLoading, setAddOrganisationLoading] = useState(false);
  const [addOrganisationError, setAddOrganisationError] = useState<Error | null>(null);
  const addOrganisation = useCallback(
    async (name: string, currency: string): Promise<string | null> => {
      if (!mero || !admin || !applicationId || !activeNs) return null;
      const trimmedName = name.trim();
      const code = currency.trim().toUpperCase();
      if (!trimmedName) {
        setAddOrganisationError(new Error('Organisation name is required'));
        return null;
      }
      setAddOrganisationLoading(true);
      setAddOrganisationError(null);
      try {
        const contextId = await createWorkspaceContext(admin, {
          applicationId,
          groupId: activeNs,
          serviceName: PRIMARY_SERVICE.name,
          name: trimmedName,
        });
        // Seed the books' own settings with the organisation's name and
        // currency, so invoices print the right header from the first one.
        // Best-effort: Settings can change both later, and neither is worth
        // failing an otherwise-created organisation over.
        try {
          const books = new BooksClient(mero, contextId);
          const settings = await books.getSettings();
          await books.updateSettings({
            organisation_name: trimmedName,
            currency: code || settings.currency,
            fy_end_month: settings.fy_end_month,
            invoice_prefix: settings.invoice_prefix,
            payment_terms_days: settings.payment_terms_days,
            tax_label: settings.tax_label,
            tax_number: settings.tax_number,
          });
        } catch { /* stays at the defaults until changed in Settings */ }
        // The replicated name (context metadata) for every other member, and
        // on a node a local alias too - an account has no node to keep one in,
        // so the alias is skipped there rather than refused.
        await publishContextName(
          admin,
          { groupId: activeNs, contextId, name: trimmedName },
          { isDelegated },
        );
        await refetchContexts();
        selectOrganisation(contextId);
        return contextId;
      } catch (err) {
        setAddOrganisationError(err instanceof Error ? err : new Error(String(err)));
        return null;
      } finally {
        setAddOrganisationLoading(false);
      }
    },
    [mero, admin, isDelegated, applicationId, activeNs, refetchContexts, selectOrganisation],
  );

  /**
   * Mint an invitation and return the JSON payload the share link carries.
   *
   * The payload is the ecosystem's shape — `{invitation, groupAlias, groupId,
   * kind}` — which is what mero-stream, mero-meet and mero-chat mint and parse,
   * so a code from any of them is readable here and vice versa. It used to be
   * the admin response `JSON.stringify`d verbatim, which was neither.
   *
   * `groupAlias` is the whole reason names cross nodes: `joinNamespace` takes a
   * `groupName` and there is nowhere else for the joiner's node to learn it from
   * at join time.
   */
  const invite = useCallback(async (): Promise<string> => {
    if (!activeNs) throw new Error('No workspace yet - create one first.');
    // Non-recursive: this app invites to the WORKSPACE, and the recursive form
    // returns a different envelope for no extra grant. Old recursive codes are
    // still decoded on the way in.
    const res = await createNamespaceInvitation(activeNs, {});
    const namespaceName =
      namespaces.find((n) => n.namespaceId === activeNs)?.name?.trim() || null;
    const payload = buildInvitePayload(res, { namespaceId: activeNs, namespaceName });
    if (!payload) {
      throw new Error('The node returned an invitation with no signature.');
    }
    return JSON.stringify(payload);
  }, [activeNs, namespaces, createNamespaceInvitation]);

  const join = useCallback(async (code: string): Promise<RedeemOutcome> => {
    // `admin`, not `mero.admin` (apps#348): on an account `joinNamespace` is
    // the account admin's claim through the relay; the node route is a 403.
    const outcome = await redeemInviteCode(code, admin);
    if (outcome.status === 'failed') return outcome;
    const nsId = outcome.namespaceId;
    // Joined (or already in it); this workspace's organisations have not replicated yet.
    // Flagged so the sidebar says "syncing" rather than "No organisations yet" — which
    // is what a joiner currently reads about a workspace full of them.
    markNamespaceJustJoined(nsId);
    // The refresh is not the join: a refresh that throws must not turn a real
    // join into a reported failure.
    try {
      await refetchNamespaces();
      selectNamespace(nsId);
      await refetchContexts();
    } catch {
      selectNamespace(nsId);
    }
    return outcome;
  }, [admin, refetchNamespaces, refetchContexts, selectNamespace]);

  // `organisationsLoading` going false is the signal the organisation list answered — for the
  // namespace that was active when it did, which is why the id is recorded
  // rather than just a boolean.
  const [listedForNs, setListedForNs] = useState<string | null>(null);
  useEffect(() => {
    if (!activeNs || organisationsLoading) return;
    setListedForNs(activeNs);
  }, [activeNs, organisationsLoading]);

  const { isSyncing, dismiss: dismissSyncing } = useJoinSync({
    namespaceId: activeNs,
    settled: listedForNs === activeNs,
  });

  const clearPersisted = useCallback(() => clearPersistedWorkspace(), []);

  return {
    isSyncing,
    dismissSyncing,
    applicationId,
    resolvingApplicationId,
    namespaces,
    activeNs,
    resolvingCallback,
    selectNamespace,
    createNamespace,
    createNamespaceLoading,
    createNamespaceError,
    join,
    invite,
    inviteLoading,
    organisations,
    activeOrganisation,
    selectOrganisation,
    addOrganisation,
    addOrganisationLoading,
    addOrganisationError,
    organisationsLoading,
    contextId: activeOrganisation,
    executorPublicKey,
    selfIdentity,
    members,
    memberNames,
    roles,
    membersLoading,
    membersLoaded,
    setMemberName,
    refetchMembers,
    ready: activeOrganisation !== null && executorPublicKey !== null,
    loading: resolvingApplicationId || nsLoading || organisationsLoading,
    error: null,
    clearPersisted,
  };
}
