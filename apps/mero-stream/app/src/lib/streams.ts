import type { AppInfo, CalimeroClient, PasskeyProvider } from "@calimero-network/mero-js";
import {
  SPENT_INVITE_COPY,
  createInviteStore,
  inviteLink as sharedInviteLink,
  isSpentInvite,
  type AppSource,
  type InviteStore,
  type KeyValueStorage,
  type PendingInvite as SharedPendingInvite,
} from "@calimero-apps/connect";
import { nodeBasename } from "@calimero-apps/node-served";

/**
 * Streams and rooms on the component runtime.
 *
 *   v1 namespace ("stream")          -> an organization (`createOrg`)
 *   v1 subgroup + context ("room")   -> an app instance in it (`createApp(.., { org })`)
 *   v1 namespace invitation          -> an org invitation (`invite`, a passkey step-up)
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

type Lister = Pick<CalimeroClient, "listApps">;

/** Every room the account reaches: instances of the dev bundle, or of the package. */
export async function listAllRooms(client: Lister, source: AppSource): Promise<AppInfo[]> {
  const filter = typeof source === "string" ? { bundle: source } : { package: source.package };
  return client.listApps(filter);
}

interface MeOrg {
  orgId: string;
  name: string;
  role: string;
}

function orgsOf(me: Record<string, unknown>): MeOrg[] {
  const orgs = me.orgs;
  if (!Array.isArray(orgs)) return [];
  return orgs.filter(
    (o): o is MeOrg =>
      !!o && typeof o === "object" && typeof (o as MeOrg).orgId === "string",
  );
}

function memberCount(info: Record<string, unknown>): number {
  const members = info.members;
  return members && typeof members === "object" ? Object.keys(members).length : 0;
}

/** The streams (organizations) the account belongs to, with their room and member counts. */
export async function listStreams(
  client: Pick<CalimeroClient, "me" | "listApps" | "getOrg">,
  source: AppSource,
): Promise<StreamRow[]> {
  const [me, apps] = await Promise.all([client.me(), listAllRooms(client, source)]);
  const rooms = new Map<string, number>();
  for (const a of apps) if (a.org) rooms.set(a.org, (rooms.get(a.org) ?? 0) + 1);
  const rows = await Promise.all(
    orgsOf(me).map(async (o) => ({
      orgId: o.orgId,
      name: (o.name ?? "").trim() || `Stream ${o.orgId.slice(0, 6)}`,
      role: String(o.role ?? "member").toLowerCase(),
      roomCount: rooms.get(o.orgId) ?? 0,
      memberCount: await client
        .getOrg(o.orgId)
        .then(memberCount)
        .catch(() => 0),
    })),
  );
  return rows.sort((a, b) => a.name.localeCompare(b.name) || a.orgId.localeCompare(b.orgId));
}

/** A new stream: an organization the caller owns. */
export function createStream(client: Pick<CalimeroClient, "createOrg">, name: string): Promise<string> {
  return client.createOrg(name);
}

/** A stream's name, its members, and the display names they set for it. */
export interface StreamInfo {
  name: string;
  members: string[];
  names: Record<string, string>;
}

export async function streamInfo(
  client: Pick<CalimeroClient, "getOrg">,
  org: string,
): Promise<StreamInfo> {
  const info = await client.getOrg(org);
  const members = info.members && typeof info.members === "object" ? Object.keys(info.members) : [];
  const names: Record<string, string> = {};
  const meta = info.memberMetadata;
  if (meta && typeof meta === "object") {
    for (const [account, value] of Object.entries(meta as Record<string, unknown>)) {
      const name = (value as { name?: unknown } | null)?.name;
      if (typeof name === "string" && name.trim()) names[account] = name.trim();
    }
  }
  const name = typeof info.name === "string" ? info.name.trim() : "";
  return { name: name || `Stream ${org.slice(0, 6)}`, members, names };
}

/**
 * Publish the caller's display name for the whole stream (v1: namespace member
 * metadata via `@calimero-apps/names`), so every room shows it.
 */
export function publishMyName(
  client: Pick<CalimeroClient, "setMemberMetadata">,
  org: string,
  account: string,
  name: string,
): Promise<void> {
  return client.setMemberMetadata(org, account, { name });
}

/** The rooms of one stream, by name. */
export async function listRooms(client: Lister, source: AppSource, org: string): Promise<RoomRow[]> {
  const apps = await listAllRooms(client, source);
  return apps
    .filter((a) => a.org === org)
    .map((a) => ({ appId: a.appId, name: a.name, org: a.org }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.appId.localeCompare(b.appId));
}

/** A new room in `org`: an app instance whose `init` names the stream. */
export function createRoom(
  client: Pick<CalimeroClient, "createApp">,
  source: AppSource,
  org: string,
  name: string,
): Promise<string> {
  return client.createApp(name, source, { org, initArgs: { name } });
}

// ── Invitations ──────────────────────────────────────────────────────────────

/** An invitation into `org` as a member, approved with the inviter's passkey (412 step-up). */
export function inviteToken(
  client: Pick<CalimeroClient, "invite">,
  org: string,
  passkey: PasskeyProvider,
): Promise<string> {
  return client.invite(org, "member", passkey);
}

/**
 * The link that opens this frontend with `token` to redeem, then the stream
 * (and, for a room invitation, the room) to open after. The stream is the
 * link's `org`, so a member is told "you're already in" without spending it.
 *
 * The link stays under the served `/{version}/` root until every cluster's
 * served-host redirect keeps the query string (core's served-redirect fix).
 */
export function inviteLink(
  token: string,
  target: { stream: string; room?: string; name?: string },
  location: Pick<Location, "href"> = window.location,
): string {
  const url = new URL(location.href);
  return sharedInviteLink(token, {
    org: target.stream,
    extra: { room: target.room, name: target.name },
    root: nodeBasename(url, "/"),
    origin: url.origin,
  });
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

/** What to say when the node refused an invitation: it is unknown, already used, expired or revoked. */
export const INVITE_REFUSED = SPENT_INVITE_COPY;

/**
 * True when `e` is the node refusing the invitation itself (see
 * `INVITE_REFUSED`): the caller drops the token. A lapsed session, a rate
 * limit or the cluster unreachable keeps it.
 */
export function inviteRefused(e: unknown): boolean {
  return isSpentInvite(e);
}

/**
 * Whether this account is already in the stream an invitation admits to:
 * `true` or `false` when the link names its stream (org), `null` when it
 * cannot be told. Redeeming as an existing member spends the token's single
 * use, which then leaves the person it was meant for unable to join.
 */
export async function alreadyMember(
  client: Pick<CalimeroClient, "me">,
  invite: PendingInvite,
): Promise<boolean | null> {
  if (!invite.stream) return null;
  try {
    return orgsOf(await client.me()).some((o) => o.orgId === invite.stream);
  } catch {
    return null;
  }
}
