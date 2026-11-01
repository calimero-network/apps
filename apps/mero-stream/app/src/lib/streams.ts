import type { AppInfo, CalimeroClient, PasskeyProvider } from "@calimero-network/mero-js";
import type { AppSource, KeyValueStorage } from "@calimero-apps/connect";

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
 * (and, for a room invitation, the room) to open after.
 */
export function inviteLink(
  token: string,
  target: { stream: string; room?: string; name?: string },
  location: Pick<Location, "origin" | "pathname"> = window.location,
): string {
  const url = new URL(location.pathname, location.origin);
  url.searchParams.set("invite", token);
  url.searchParams.set("stream", target.stream);
  if (target.room) url.searchParams.set("room", target.room);
  if (target.name) url.searchParams.set("name", target.name);
  return url.toString();
}

export interface PendingInvite {
  token: string;
  stream: string | null;
  room: string | null;
  /** What the inviter called it, for the "Join X?" prompt only. */
  name: string | null;
}

const PENDING = "mero-stream:pending-invite";

/**
 * Take `?invite=` (and `&stream=`, `&room=`, `&name=`) off the address bar
 * into storage before anything renders: whoever opens a link is usually not
 * signed in yet, and the token has to survive the passkey sign-up.
 */
export function captureInvite(
  storage: KeyValueStorage = localStorage,
  loc: Location = window.location,
): void {
  const url = new URL(loc.href);
  const token = url.searchParams.get("invite");
  if (!token) return;
  const pending: PendingInvite = {
    token,
    stream: url.searchParams.get("stream"),
    room: url.searchParams.get("room"),
    name: url.searchParams.get("name"),
  };
  try {
    storage.setItem(PENDING, JSON.stringify(pending));
  } catch {
    return;
  }
  for (const k of ["invite", "stream", "room", "name"]) url.searchParams.delete(k);
  window.history.replaceState(null, "", url.toString());
}

export function pendingInvite(storage: KeyValueStorage = localStorage): PendingInvite | null {
  try {
    const raw = storage.getItem(PENDING);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<PendingInvite>;
    if (typeof p.token !== "string") return null;
    const str = (v: unknown) => (typeof v === "string" && v ? v : null);
    return { token: p.token, stream: str(p.stream), room: str(p.room), name: str(p.name) };
  } catch {
    return null;
  }
}

export function dropInvite(storage: KeyValueStorage = localStorage): void {
  try {
    storage.removeItem(PENDING);
  } catch {
    /* nothing stored */
  }
}
