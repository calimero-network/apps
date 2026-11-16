import {
  passkeyConfirm,
  DEFAULT_ORG_CAPABILITIES,
  ORG_CAPABILITIES,
  type AppInfo,
  type CalimeroClient,
  type PasskeyProvider,
} from "@calimero-network/mero-js";
import {
  appPeople,
  appTarget,
  finishAppOrg,
  createInviteStore,
  inviteLinkBase,
  isAppOnly,
  listAppInfos,
  orgInstanceOptions,
  orgsWithApp,
  sourcePackage,
  type AppOrgView,
  type AppSource,
  type ClientRoutes,
  type InviteStore,
  type KeyValueStorage,
  type PendingInvite as SharedPendingInvite,
} from "@calimero-apps/connect";
import { setOrgName } from "@calimero-apps/names";
import { nodeBasename } from "@calimero-apps/node-served";

/**
 * Streams and rooms on the component runtime.
 *
 *   v1 namespace ("stream")          -> an organization (`createOrg`)
 *   v1 subgroup + context ("room")   -> an app instance in it (`createApp(.., { org })`)
 *   v1 namespace invitation          -> an org invitation (mero-react's shared dialogs)
 *
 * Everyone in the organization reaches every room in it, which is what v1's
 * open subgroups gave invitees. There is no separate "join the room" step any
 * more: the org grants the room, and the contract's own `join` records the
 * display name.
 */

/** One stream, as the picker shows it. */
export interface StreamRow {
  orgId: string;
  name: string;
  /** The caller's role there: `owner`, `admin`, `member` or `guest`. */
  role: string;
  roomCount: number;
  memberCount: number;
}

/** One room, as the room list shows it. */
export interface RoomRow {
  appId: string;
  name: string;
  org: string | null;
}

type Lister = ClientRoutes<{ apps: "list" }>;

/** Every room the account reaches: instances of the dev bundle, or of the package. */
export async function listAllRooms(client: Lister, source: AppSource): Promise<AppInfo[]> {
  const filter = typeof source === "string" ? { bundle: source } : { package: source.package };
  return listAppInfos(client, filter);
}

/** The app's name where an owner or admin is told who may add it, and in invite notes. */
export const PRODUCT_NAME = "Mero Stream";

/** Where no passkey was handed over: asked for only to add Mero Stream's team to an org. */
const noPasskey = (): PasskeyProvider => {
  throw new Error(`A passkey is needed to add ${PRODUCT_NAME} to this organization.`);
};

/** How many have Mero Stream in the org: its app team, else the org (no guest once it has app teams). */
function memberCount(info: Record<string, unknown>, source: AppSource): number {
  return appPeople(info as AppOrgView, sourcePackage(source)).length;
}

/**
 * The streams: the organizations the account belongs to that hold a room or
 * were made for Mero Stream, with their room and member counts. An org made
 * for another app is offered under "Connect to an existing organization".
 */
export async function listStreams(
  client: ClientRoutes<{ auth: "me"; apps: "list"; orgs: "get" }>,
  source: AppSource,
): Promise<StreamRow[]> {
  const [orgs, apps] = await Promise.all([orgsWithApp(client, source, { marked: true }), listAllRooms(client, source)]);
  const rooms = new Map<string, number>();
  for (const a of apps) if (a.org) rooms.set(a.org, (rooms.get(a.org) ?? 0) + 1);
  const rows = await Promise.all(
    orgs.map(async (o) => ({
      orgId: o.orgId,
      name: (o.name ?? "").trim() || `Stream ${o.orgId.slice(0, 6)}`,
      role: String(o.role ?? "member").toLowerCase(),
      roomCount: rooms.get(o.orgId) ?? 0,
      memberCount: await client.orgs.get({ org: o.orgId })
        .then((info) => memberCount(info as Record<string, unknown>, source))
        .catch(() => 0),
    })),
  );
  return rows.sort((a, b) => a.name.localeCompare(b.name) || a.orgId.localeCompare(b.orgId));
}

/**
 * What a member of a stream made here may do unless an owner says otherwise:
 * core's own default (join open teams) plus `CREATE_APP`, so members add
 * rooms the way anyone in a Slack workspace adds a channel.
 */
export const MEMBER_DEFAULTS = DEFAULT_ORG_CAPABILITIES | ORG_CAPABILITIES.CREATE_APP;

export interface CreatedStream {
  orgId: string;
  /** Set when the stream exists but its member defaults could not be set (a cancelled passkey). */
  warning: string | null;
}

/**
 * What follows a stream the node approved: its mark, the member defaults (a
 * passkey step-up, skipped on a session bound to the app) and Mero Stream's
 * own team, open (declined, or an older node: a legacy org).
 */
export async function finishStream(
  client: ClientRoutes<{ orgs: "capabilities" | "get" | "metadata" | "appTeamsScope" }>,
  orgId: string,
  passkey: () => PasskeyProvider,
  source?: AppSource,
): Promise<CreatedStream> {
  const made = await finishAppOrg(client, orgId, source, passkey, { capabilities: MEMBER_DEFAULTS });
  return {
    orgId: made.orgId,
    warning: made.capabilitiesError
      ? "The stream was created, but people you invite cannot create rooms yet. Turn on \u201cMembers can create rooms\u201d in the stream to let them."
      : null,
  };
}

/** Whether the org's default lets a plain member create rooms. */
export function membersCreateRooms(memberDefaults: number): boolean {
  return (memberDefaults & ORG_CAPABILITIES.CREATE_APP) !== 0;
}

/**
 * Turn "Members can create rooms" on or off: `CREATE_APP` in the org's
 * default, the other bits kept. A member an owner set capabilities for keeps
 * their own. Owner or admin only, with their passkey.
 */
export async function setMembersCreateRooms(
  client: ClientRoutes<{ orgs: "capabilities" }>,
  org: string,
  memberDefaults: number,
  on: boolean,
  passkey: PasskeyProvider,
): Promise<void> {
  const next = on
    ? memberDefaults | ORG_CAPABILITIES.CREATE_APP
    : memberDefaults & ~ORG_CAPABILITIES.CREATE_APP;
  await client.orgs.capabilities({ org, capabilities: next }, { confirm: passkeyConfirm(passkey) });
}

/** A stream's name, its members, and the display names they set for it. */
export interface StreamInfo {
  name: string;
  /** Who has Mero Stream in the org: its app team, else every member (no guest once it has app teams). */
  members: string[];
  /** Set when the org keeps its apps apart and Mero Stream has its team: an invite gives Mero Stream only. */
  appOnly?: true;
  names: Record<string, string>;
  /** Each member's role (`owner`, `admin`, `member`, `guest`). */
  roles: Record<string, string>;
  /** The org's default capabilities: what a member holds unless set for them. */
  memberDefaults: number;
}

export async function streamInfo(
  client: ClientRoutes<{ orgs: "get" }>,
  org: string,
  source: AppSource | null = null,
): Promise<StreamInfo> {
  const info = await client.orgs.get({ org });
  const pkg = sourcePackage(source);
  const members = appPeople(info as AppOrgView, pkg);
  const names: Record<string, string> = {};
  const meta = info.memberMetadata;
  if (meta && typeof meta === "object") {
    for (const [account, value] of Object.entries(meta as Record<string, unknown>)) {
      const name = (value as { name?: unknown } | null)?.name;
      if (typeof name === "string" && name.trim()) names[account] = name.trim();
    }
  }
  const roles: Record<string, string> = {};
  if (info.members && typeof info.members === "object") {
    for (const [account, role] of Object.entries(info.members as Record<string, unknown>)) {
      roles[account] = String(role).toLowerCase();
    }
  }
  const memberDefaults =
    typeof info.defaultCapabilities === "number" ? info.defaultCapabilities : DEFAULT_ORG_CAPABILITIES;
  const name = typeof info.name === "string" ? info.name.trim() : "";
  return {
    name: name || `Stream ${org.slice(0, 6)}`,
    members,
    ...(isAppOnly(info as AppOrgView, pkg) ? { appOnly: true as const } : {}),
    names,
    roles,
    memberDefaults,
  };
}

/**
 * Publish the caller's display name for the whole stream (org member
 * metadata, merged with what the record holds), so every room shows it. The
 * stream is where your name lives: asked when you create or join it, and
 * every room's `join` is fed it.
 */
export function publishMyName(
  client: ClientRoutes<{ orgs: "get" | "memberMetadata" }>,
  org: string,
  account: string,
  name: string,
): Promise<void> {
  return setOrgName(client, org, account, name);
}

/** The rooms of one stream, by name. */
export async function listRooms(client: Lister, source: AppSource, org: string): Promise<RoomRow[]> {
  const apps = await listAllRooms(client, source);
  return apps
    .filter((a) => a.org === org)
    .map((a) => ({ appId: a.appId, name: a.name, org: a.org }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.appId.localeCompare(b.appId));
}

/** The room created in an org the account connects to Mero Stream ("Connect to an existing organization"). */
export const CONNECTED_ROOM_NAME = "General";

/**
 * A new room in `org`: an app instance whose `init` names the stream, on
 * Mero Stream's team (`orgInstanceOptions`: made first, by an owner or admin,
 * in an org whose other apps have teams; organization access in a legacy org).
 */
export async function createRoom(
  client: Pick<CalimeroClient, "session"> & ClientRoutes<{ apps: "create"; orgs: "get" | "appTeamsScope" }>,
  source: AppSource,
  org: string,
  name: string,
  passkey: () => PasskeyProvider = noPasskey,
): Promise<string> {
  const options = await orgInstanceOptions(client, org, source, passkey, PRODUCT_NAME);
  return client.apps.create({ name, ...appTarget(source), ...options, initArgs: { name } }).then((r) => r.appId);
}

// ── Invitations ──────────────────────────────────────────────────────────────

/**
 * The page the shared invite dialog's link opens: this frontend's root (under
 * the served `/{version}/` until every cluster's served-host redirect keeps
 * the query string), naming the stream so a member is told "you're already
 * in" without spending the token, and the room and name when it opens one.
 */
export function inviteBase(
  target: { stream: string; room?: string; name?: string },
  location: Pick<Location, "href"> = window.location,
): string {
  const url = new URL(location.href);
  const { room, name } = target;
  return inviteLinkBase({ org: target.stream, extra: { room, name }, root: nodeBasename(url, "/"), origin: url.origin });
}

export interface PendingInvite {
  token: string;
  stream: string | null;
  room: string | null;
  /** What the inviter called it, for the "Join X?" prompt only. */
  name: string | null;
}

/**
 * This app's pending invite (`@calimero-apps/connect`): the stream is its
 * `org`, the room and name its own. Links minted before the shared store said
 * `stream`, which is kept too, so they still open what they named.
 */
export const invites = createInviteStore("mero-stream", { keep: ["room", "name", "stream"] });

const LEGACY_PENDING = "mero-stream:pending-invite";

/**
 * Take `?invite=` (and the stream, room and name) off the address bar into
 * the store before anything renders: whoever opens a link is usually not
 * signed in yet, and the token has to survive the passkey sign-up. An invite
 * an earlier build stored under its own key moves over first.
 */
export function captureInvite(loc: Pick<Location, "href"> = window.location): void {
  migrateLegacyInvite();
  invites.capture(loc, { basename: nodeBasename(new URL(loc.href), "/") });
}

/** Moves an invite an earlier build stored under its own key into the shared store. */
export function migrateLegacyInvite(storage: KeyValueStorage = localStorage, into: InviteStore = invites): void {
  try {
    const raw = storage.getItem(LEGACY_PENDING);
    if (!raw) return;
    storage.removeItem(LEGACY_PENDING);
    const p = JSON.parse(raw) as Partial<PendingInvite>;
    if (typeof p.token !== "string" || !p.token) return;
    const extra: Record<string, string> = {};
    if (typeof p.room === "string" && p.room) extra.room = p.room;
    if (typeof p.name === "string" && p.name) extra.name = p.name;
    into.put({
      token: p.token,
      org: typeof p.stream === "string" && p.stream ? p.stream : null,
      team: null,
      doc: null,
      route: null,
      extra,
    });
  } catch {
    /* unreadable: nothing to move */
  }
}

/** The app's view of a pending invite. */
export function streamInvite(pending: SharedPendingInvite | null): PendingInvite | null {
  if (!pending) return null;
  return {
    token: pending.token,
    stream: pending.org ?? pending.extra.stream ?? null,
    room: pending.extra.room ?? null,
    name: pending.extra.name ?? null,
  };
}

/**
 * The invite a sign-up from this page joined with, kept after the store
 * dropped it, for `InvitationPrompt` to open what the link named (nothing is
 * redeemed again).
 */
let joinedAtSignUp: PendingInvite | null = null;

/** `onJoinedAtSignUp` for `usePasskeySession`. */
export function noteJoinedAtSignUp(
  joined: { invite: string; org: string | null },
  pending: SharedPendingInvite | null,
): void {
  const invite = streamInvite(pending);
  joinedAtSignUp = invite
    ? { ...invite, stream: invite.stream ?? joined.org }
    : { token: joined.invite, stream: joined.org, room: null, name: null };
}

/** The pending invite, or the one a sign-up just joined with. */
export function pendingInvite(): PendingInvite | null {
  return streamInvite(invites.pending()) ?? joinedAtSignUp;
}

export function dropInvite(): void {
  invites.drop();
  joinedAtSignUp = null;
}
