/**
 * Workspaces, agreements and the private signature library on Calimero 1.0.
 *
 * | v1 | here |
 * |---|---|
 * | a workspace: a namespace of the app | an **organization** (`createOrg`) |
 * | an agreement: a subgroup + its context, `init(false, name)` | an **app instance** in the org (`createApp(name, source, { org })`), then `setup(false, name)` |
 * | the private signature library: a context `init(true, "default")` in a hidden personal namespace | an app instance the account owns, in no org, then `setup(true, "default")` |
 * | joining an agreement by inheritance, waiting for it to replicate | nothing: every member of the org reaches its instances; `registerSelfAsParticipant` adds you to the agreement's roster |
 * | a member key per context | the account: one id everywhere |
 *
 * Everything takes the client (and where instances come from, `source`) as an
 * argument so it is testable with a fake.
 */
import {
  ORG_CAPABILITIES,
  type AppInfo,
  type CalimeroClient,
  type PasskeyProvider,
} from '@calimero-network/mero-js';
import {
  appPeople,
  appTarget,
  createAppOrg,
  isAppOnly,
  listAppInfos,
  orgInstanceOptions,
  orgsWithApp,
  sourcePackage,
  type AppOrgView,
  type AppSource,
  type ClientRoutes,
} from '@calimero-apps/connect';

/** The app's name where an owner or admin is told who may add it, and in invite notes. */
export const PRODUCT_NAME = 'Mero Sign';

/** Where no passkey was handed over: asked for only to add Mero Sign's team to an org. */
const noPasskey = (): PasskeyProvider => {
  throw new Error(`A passkey is needed to add ${PRODUCT_NAME} to this organization.`);
};

import { MeroSignClient } from '../generated/client';
import type { Transport } from './meroSign';

export type StatusFn = (message: string) => void;
const noop: StatusFn = () => {};

/** The instance name of an account's private signature library. */
export const LIBRARY_NAME = 'mero-sign:library';

/** A readable label, or a short id — never an empty string. */
export function displayName(
  candidates: (string | null | undefined)[],
  id: string,
  fallbackPrefix: string,
): string {
  for (const candidate of candidates) {
    const trimmed = (candidate ?? '').trim();
    if (trimmed) return trimmed;
  }
  return `${fallbackPrefix} ${id.slice(0, 8)}…`;
}

/** The instances of this app (the dev bundle, or the package) the account reaches. */
export async function listInstances(
  client: ClientRoutes<{ apps: 'list' }>,
  source: AppSource,
): Promise<AppInfo[]> {
  const filter =
    typeof source === 'string' ? { bundle: source } : { package: source.package };
  return listAppInfos(client, filter);
}

// ── workspaces ───────────────────────────────────────────────────────────────

export interface WorkspaceRow {
  /** The org id. */
  namespaceId: string;
  name: string;
  /** `owner` | `admin` | `member` | `guest`. */
  role: string;
  agreementCount: number;
  memberCount: number;
}

/**
 * The workspaces: the orgs this account is in that hold an agreement or were
 * made for Mero Sign, with agreement and member counts. An org made for
 * another app is offered under "Connect to an existing organization" instead.
 */
export async function listWorkspaces(
  client: ClientRoutes<{ auth: 'me'; apps: 'list'; orgs: 'get' }>,
  source: AppSource,
): Promise<WorkspaceRow[]> {
  const [orgs, apps] = await Promise.all([
    orgsWithApp(client, source, { marked: true }),
    listInstances(client, source),
  ]);
  const rows = await Promise.all(
    orgs.map(async (o) => {
      const members = await readMembers(client, o.orgId).catch(() => null);
      return {
        namespaceId: o.orgId,
        name: o.name,
        role: o.role,
        agreementCount: apps.filter((a) => a.org === o.orgId).length,
        memberCount: members ? members.roles.size : 0,
      };
    }),
  );
  return rows.sort(
    (a, b) =>
      a.name.localeCompare(b.name) || a.namespaceId.localeCompare(b.namespaceId),
  );
}

/**
 * What a member may do unless an admin sets otherwise, as v1 set it on a new
 * namespace: create agreements and invite people.
 */
export const MEMBER_DEFAULTS =
  ORG_CAPABILITIES.CREATE_APP |
  ORG_CAPABILITIES.INVITE_MEMBERS |
  ORG_CAPABILITIES.JOIN_OPEN_TEAMS;

/**
 * A new workspace: an org whose members may create agreements and invite.
 * Setting the defaults is a passkey step-up; refused, the org stays and only
 * its owner and admins can create agreements and invite.
 */
export async function createWorkspace(
  client: ClientRoutes<{ orgs: 'create' | 'capabilities' | 'get' | 'metadata' | 'appTeamsScope' }>,
  name: string,
  passkey: () => PasskeyProvider,
  onStatus: StatusFn = noop,
  source?: AppSource,
): Promise<{ namespaceId: string; warning: string | null }> {
  onStatus('Creating the workspace…');
  // The org, marked so it is listed as a workspace before it holds an
  // agreement, its member defaults, and Mero Sign's own team, open (declined,
  // or an older node: a legacy org).
  const made = await createAppOrg(client, name, source, passkey, { capabilities: MEMBER_DEFAULTS });
  return {
    namespaceId: made.orgId,
    warning: made.capabilitiesError
      ? 'people you invite will not be able to create agreements or invite others'
      : null,
  };
}

// ── members ──────────────────────────────────────────────────────────────────

export interface OrgMembers {
  name: string;
  /** account -> `owner` | `admin` | `member` | `guest`. */
  roles: Map<string, string>;
  /** account -> the name they set for the workspace, where one is set. */
  names: Map<string, string>;
  /** Who has Mero Sign in the workspace, in org order: its app team, else the org (no guest once it has app teams). */
  people: string[];
  /** The org keeps its apps apart and Mero Sign has its team: an invite gives Mero Sign only. */
  appOnly: boolean;
}

export async function readMembers(
  client: ClientRoutes<{ orgs: 'get' }>,
  org: string,
  source: AppSource | null = null,
): Promise<OrgMembers> {
  const o = (await client.orgs.get({ org })) as Record<string, unknown>;
  const pkg = sourcePackage(source);
  const members = (o.members ?? {}) as Record<string, string>;
  const meta = (o.memberMetadata ?? {}) as Record<string, unknown>;
  const names = new Map<string, string>();
  for (const [account, value] of Object.entries(meta)) {
    const name = (value as { name?: unknown } | null)?.name;
    if (typeof name === 'string' && name.trim()) names.set(account, name.trim());
  }
  return {
    name: typeof o.name === 'string' ? o.name : '',
    roles: new Map(Object.entries(members)),
    names,
    people: appPeople(o as AppOrgView, pkg),
    appOnly: isAppOnly(o as AppOrgView, pkg),
  };
}

/** Publishes the name `account` goes by across the workspace (org member metadata). */
export async function publishWorkspaceName(
  client: ClientRoutes<{ orgs: 'memberMetadata' }>,
  org: string,
  account: string,
  name: string,
): Promise<void> {
  await client.orgs.memberMetadata({ org, account, metadata: { name } });
}

// ── the private signature library ────────────────────────────────────────────

/**
 * The account's private library: the instance named {@link LIBRARY_NAME} it
 * owns outside any org, created and set up on first use.
 */
export async function ensurePrivateLibrary(
  client: ClientRoutes<{ apps: 'list' | 'create' | 'call' | 'view' }> & Transport,
  source: AppSource,
  accountId: string,
  after: () => void = () => {},
): Promise<string> {
  const found = (await listInstances(client, source)).find(
    (a) => a.name === LIBRARY_NAME && a.owner === accountId && !a.org,
  );
  if (found) {
    // Set up once; an instance whose setup never ran is set up now.
    const lib = new MeroSignClient(client, found.appId, { after });
    if (!(await lib.isDefaultPrivateContext())) {
      await lib.setup({ isPrivate: true, contextName: 'default' });
    }
    return found.appId;
  }
  const appId = (await client.apps.create({ name: LIBRARY_NAME, ...appTarget(source) })).appId;
  await new MeroSignClient(client, appId, { after }).setup({
    isPrivate: true,
    contextName: 'default',
  });
  return appId;
}

// ── agreements ───────────────────────────────────────────────────────────────

export interface AgreementRow {
  /** The app instance id. */
  agreementId: string;
  /** The same id: v1 told the subgroup and its context apart. */
  contextId: string;
  name: string;
  /** Participants on the agreement's roster, when it could be read. */
  memberCount: number;
  /** Whether the caller is on the roster. */
  joined: boolean;
  /** The account that created the instance. */
  owner: string;
}

/** The agreements in workspace `org`, by name. */
export async function listAgreements(
  client: ClientRoutes<{ apps: 'list' }> & Transport,
  source: AppSource,
  org: string,
  accountId: string,
): Promise<AgreementRow[]> {
  const apps = (await listInstances(client, source)).filter((a) => a.org === org);
  const rows = await Promise.all(
    apps.map(async (a) => {
      const roster = await new MeroSignClient(client, a.appId)
        .listParticipants()
        .catch(() => null);
      return {
        agreementId: a.appId,
        contextId: a.appId,
        name: displayName([a.name], a.appId, 'Agreement'),
        memberCount: roster?.length ?? 0,
        joined: roster ? roster.includes(accountId) : a.owner === accountId,
        owner: a.owner,
      };
    }),
  );
  return rows.sort(
    (a, b) =>
      a.name.localeCompare(b.name) || a.agreementId.localeCompare(b.agreementId),
  );
}

/** The agreement created in an org the account connects to Mero Sign ("Connect to an existing organization"). */
export const CONNECTED_AGREEMENT_NAME = 'Untitled agreement';

/**
 * A new agreement in workspace `org`: the instance, its `setup` (the creator
 * is its first admin), and a record of it in the creator's private library.
 * Answers the instance id.
 */
export async function createAgreement(
  client: Pick<CalimeroClient, 'session' | 'events'> &
    ClientRoutes<{ apps: 'create' | 'list' | 'call' | 'view'; orgs: 'get' | 'appTeamsScope' }>,
  opts: {
    source: AppSource;
    org: string;
    name: string;
    accountId: string;
    /** For adding Mero Sign to an org whose other apps have teams (an owner's or admin's step-up). */
    passkey?: () => PasskeyProvider;
  },
  onStatus: StatusFn = noop,
  after: () => void = () => {},
): Promise<string> {
  onStatus('Creating the agreement…');
  // On Mero Sign's team (made first, by an owner or admin, in an org whose
  // other apps have teams), or organization access in a legacy org.
  const appId = (
    await client.apps.create({
      name: opts.name,
      ...appTarget(opts.source),
      ...(await orgInstanceOptions(client, opts.org, opts.source, opts.passkey ?? noPasskey, PRODUCT_NAME)),
    })
  ).appId;
  onStatus('Preparing its documents…');
  await new MeroSignClient(client, appId, { after }).setup({
    isPrivate: false,
    contextName: opts.name,
  });
  await recordInLibrary(client, opts.source, opts.accountId, appId, opts.name, after);
  return appId;
}

/** Records a joined agreement in the private library; best-effort. */
export async function recordInLibrary(
  client: ClientRoutes<{ apps: 'list' | 'create' | 'call' | 'view' }> & Transport,
  source: AppSource,
  accountId: string,
  appId: string,
  name: string,
  after: () => void = () => {},
): Promise<void> {
  try {
    const library = await ensurePrivateLibrary(client, source, accountId, after);
    await new MeroSignClient(client, library, { after }).joinSharedContext({
      contextIdStr: appId,
      sharedIdentityStr: accountId,
      contextName: name,
    });
  } catch {
    // "Already joined" or a library not reachable yet: the agreement itself
    // is what matters, and it is listed from the workspace either way.
  }
}

/**
 * Enters an agreement: puts the caller on its roster (as a signer) if they
 * are not on it yet, and records it in their library. Answers their account.
 *
 * A member of the workspace joins by themselves; a guest, or someone an admin
 * removed, is refused by the contract and gets its sentence.
 */
export async function enterAgreement(
  client: ClientRoutes<{ apps: 'list' | 'create' | 'call' | 'view' }> & Transport,
  opts: { source: AppSource; appId: string; accountId: string; name: string },
  after: () => void = () => {},
): Promise<string> {
  const agreement = new MeroSignClient(client, opts.appId, { after });
  const roster = await agreement.listParticipants();
  if (!roster.includes(opts.accountId)) {
    try {
      await agreement.registerSelfAsParticipant();
    } catch (e) {
      const code = (e as { appCode?: string } | null)?.appCode;
      // Forbidden (a guest, or removed): they may still read it.
      if (code !== 'Conflict' && code !== 'Forbidden') throw e;
    }
    await recordInLibrary(
      client,
      opts.source,
      opts.accountId,
      opts.appId,
      opts.name,
      after,
    );
  }
  return opts.accountId;
}

/**
 * Which agreement an invitation should land you in: the one the link names
 * when it is in the workspace, else the only one, else none (the list).
 */
export function pickInvitedAgreement<T extends { contextId: string | null }>(
  agreements: T[],
  hintedContextId: string | null | undefined,
): T | null {
  const joinable = agreements.filter((a) => !!a.contextId);
  if (hintedContextId) {
    const hinted = joinable.find((a) => a.contextId === hintedContextId);
    if (hinted) return hinted;
  }
  return joinable.length === 1 ? joinable[0] : null;
}
