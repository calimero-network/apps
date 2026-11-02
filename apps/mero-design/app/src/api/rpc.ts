import { AppError, ORG_CAPABILITIES, TrapError, type AppInfo, type CalimeroClient } from "@calimero-network/mero-js";
import type { AppSource } from "@calimero-apps/connect";
import { getApi } from "./client";
import { elementFromContract, elementToContract, toWire, type Page } from "./meroDesign";
import { getCachedBlob, setCachedBlob } from "../utils/blobCache";
import { fromWire, metaOf, packLabel, toWire as elementToWire } from "../utils/elementMeta";
import { useCanvasStore } from "../store/canvasStore";
import type { Element } from "../types";

/**
 * v1 → Calimero 1.0, for this app:
 *
 * | v1 | here |
 * |---|---|
 * | a team: a namespace of the app | an **organization** (`createOrg`) |
 * | a board: a subgroup of the team + the context bound to it | an **app instance** in the org (`createApp(name, source, { org })`) |
 * | the board's name: the context's (and subgroup's) metadata | the instance's `name`, then the contract's own (`updateBoard`) |
 * | team roles: namespace Admin / Member | org `owner` / `admin` (Admin) and `member` / `guest` (Member) |
 * | a team invitation: a signed payload in a link | an **org invite** token in `?invite=` (a passkey step-up) |
 * | your name in the team: namespace member metadata | org **member metadata** `{ name }` |
 * | joining a board's context, waiting for it to sync | nothing: every member of the org reaches its instances |
 * | blobs announced to the context | blobs of the app instance (`uploadBlob` / `downloadBlob`) |
 */

// ── Contract calls ───────────────────────────────────────────────────────────

/**
 * Fold the client-side element extras into `label` on the way out.
 *
 * Only the methods that write a label carry them (see `utils/elementMeta.ts`).
 * A label rename looks the element up in the store so a rename never strips
 * its dash style or sticky-ness; a caller that is changing the extras
 * themselves passes the updated element as `__element`, because the store
 * write it just made may not be the one this reads.
 */
export function packArgs(method: string, args: Record<string, unknown>): Record<string, unknown> {
  if (method === "add_element" && args.element && typeof args.element === "object") {
    return { ...args, element: elementToContract(elementToWire(args.element as Element)) };
  }
  if (method === "add_elements" && Array.isArray(args.elements)) {
    return { ...args, elements: (args.elements as Element[]).map((el) => elementToContract(elementToWire(el))) };
  }
  if (method === "update_element_label") {
    const { __element, ...rest } = args as { __element?: Element } & Record<string, unknown>;
    const source = __element
      ?? useCanvasStore.getState().elements.find((e) => e.id === rest.id);
    const label = (rest.label as string | null | undefined) ?? null;
    return { ...rest, label: source ? packLabel(label, metaOf(source)) : label };
  }
  if (method === "update_element_labels" && Array.isArray(args.labels)) {
    // Same packing as the single rename, one lookup table for the whole batch.
    const byId = new Map(useCanvasStore.getState().elements.map((e) => [e.id, e] as const));
    const labels = (args.labels as { id: string; label?: string | null }[]).map(({ id, label }) => {
      const source = byId.get(id);
      const plain = label ?? null;
      return { id, label: source ? packLabel(plain, metaOf(source)) : plain };
    });
    return { ...args, labels };
  }
  return args;
}

/** Unpack every element a read returns: the inverse of `packArgs`. */
export function unpackResult<T>(method: string, value: T): T {
  if ((method === "get_elements" || method === "get_elements_by_ids") && Array.isArray(value)) {
    return value.map((el) => fromWire(elementFromContract(el as Element))) as T;
  }
  if (method === "get_element" && value && typeof value === "object") {
    return fromWire(elementFromContract(value as unknown as Element)) as T;
  }
  return value;
}

/**
 * A readable error for a failed request: the contract's own message
 * (`422 APP_ERROR { code, fields: { message } }`) when it gave one.
 */
export function callFailure(err: unknown): Error {
  if (err instanceof AppError) {
    const message = err.fields?.message;
    if (typeof message === "string" && message) return new Error(message);
    return new Error(err.appCode || err.message);
  }
  if (err instanceof TrapError) return new Error(`The board refused the change (${err.kind || "trap"}).`);
  return err instanceof Error ? err : new Error(String(err));
}

/** Elements per `getElements` page when `get_elements` wants the whole board. */
const ELEMENT_PAGE = 1000;

type Contract = Pick<CalimeroClient, "call" | "view">;

async function send(client: Contract, app: string, method: string, args: Record<string, unknown>): Promise<unknown> {
  const req = toWire(method, args);
  const res = req.kind === "call"
    ? await client.call(app, req.name, req.args)
    : await client.view(app, req.name, req.args);
  return res.result;
}

/**
 * Every row of a paged read (`getElements`, `getComments`: `{ items, next }`),
 * following `next`, as v1's single read returned the collection whole. The
 * screens hold the whole board, so the client gathers it; the contract never
 * answers more than a page per call.
 */
async function allPages<T>(client: Contract, app: string, method: string, limit: number): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | null = null;
  for (;;) {
    const page = (await send(client, app, method, { cursor, limit })) as Partial<Page<T>> | null;
    out.push(...(page?.items ?? []));
    if (!page?.next) return out;
    cursor = page.next;
  }
}

/**
 * Run a chunked clear (`clearElements`, `clearComments`) to the end: each call
 * deletes a bounded batch and answers how many are left, as a decimal string.
 */
async function clearAll(client: Contract, app: string, method: string): Promise<null> {
  for (let calls = 0; calls < 10_000; calls++) {
    const left = await send(client, app, method, {});
    if (left === null || left === undefined || String(left) === "0") return null;
  }
  throw new Error(`${method} did not finish`);
}

async function dispatch(client: Contract, app: string, method: string, args: Record<string, unknown>): Promise<unknown> {
  switch (method) {
    case "get_elements":
      return allPages<Element>(client, app, method, ELEMENT_PAGE);
    case "get_comments":
      return allPages<unknown>(client, app, method, 100);
    case "clear_elements":
    case "clear_comments":
      return clearAll(client, app, method);
    default:
      return send(client, app, method, args);
  }
}

/**
 * Call a contract method of the board `app` (an app instance id) by its v1 name
 * with v1's arguments; `meroDesign.ts` maps them onto the component's wire.
 */
export async function rpcCall<T>(
  app: string,
  method: string,
  args: Record<string, unknown>,
): Promise<T> {
  const { client, after } = getApi();
  try {
    const packed = packArgs(method, args);
    await carryBlobs(app, method, packed);
    const out = await dispatch(client, app, method, packed);
    rememberBlobs(app, method, out);
    return unpackResult(method, out as T);
  } catch (err) {
    throw callFailure(err);
  } finally {
    after();
  }
}

// ── Who am I ─────────────────────────────────────────────────────────────────

export interface NodeIdentity {
  /** The signed-in account. What members, authors and owners are named by. */
  accountId: string;
}

/** The signed-in account (v1 asked the node; the session already knows). */
export async function getNodeIdentity(): Promise<NodeIdentity> {
  return { accountId: getApi().accountId };
}

// ── Teams: organizations ─────────────────────────────────────────────────────

/** What `/me` answers about orgs. */
interface MeOrgs {
  orgs?: Array<{ orgId: string; name: string; role: string }>;
}

export interface TeamEntry {
  /** The org id. */
  namespaceId: string;
  name?: string;
  /** `owner` | `admin` | `member` | `guest`. */
  role: string;
}

/** Every team this account is in. */
export async function listTeams(): Promise<TeamEntry[]> {
  const { client, after } = getApi();
  try {
    const me = (await client.me()) as MeOrgs;
    return (me.orgs ?? []).map((o) => ({ namespaceId: o.orgId, name: o.name || undefined, role: o.role }));
  } finally {
    after();
  }
}

/** The caller's role in `org`, or null when not in it. */
export async function myTeamRole(org: string): Promise<string | null> {
  return (await listTeams()).find((t) => t.namespaceId === org)?.role ?? null;
}

/** An org owner or admin: may delete the team and manage its members. */
export const isTeamAdminRole = (role: string | null | undefined): boolean => role === "owner" || role === "admin";

/**
 * What a member may do unless an admin sets otherwise, as v1 set it on a new
 * namespace: create boards and invite people (and join open teams, the node's
 * own default).
 */
export const MEMBER_DEFAULTS =
  ORG_CAPABILITIES.CREATE_APP | ORG_CAPABILITIES.INVITE_MEMBERS | ORG_CAPABILITIES.JOIN_OPEN_TEAMS;

export interface CreatedTeam {
  namespaceId: string;
  /** The team exists, but members may not create boards or invite (the step-up was refused). */
  warning?: string;
}

/**
 * Found a team: an org whose members may create boards and invite. Setting
 * those defaults is a passkey step-up; refused, the org stays (only its owner
 * and admins can then create boards and invite).
 */
export async function createTeam(name: string): Promise<CreatedTeam> {
  const { client, passkey, after } = getApi();
  try {
    const namespaceId = await client.createOrg(name);
    try {
      await client.setCapabilities(namespaceId, MEMBER_DEFAULTS, passkey());
      return { namespaceId };
    } catch {
      return {
        namespaceId,
        warning: "The team was created, but people you invite will not be able to create boards or invite others.",
      };
    }
  } finally {
    after();
  }
}

/** Deletes the org and every board in it, for everyone. Its owner only; a passkey step-up. */
export async function deleteTeam(org: string): Promise<void> {
  const { client, passkey, after } = getApi();
  try {
    await client.deleteOrg(org, passkey());
  } finally {
    after();
  }
}

/** Leave a team (remove yourself). A passkey step-up. */
export async function leaveTeam(org: string): Promise<void> {
  const { client, passkey, accountId, after } = getApi();
  try {
    await client.removeMember(org, accountId, passkey());
  } finally {
    after();
  }
}

/** An invitation into `org` as a member, approved with the inviter's passkey. Answers its token. */
export async function createTeamInvitation(org: string): Promise<string> {
  const { client, passkey, after } = getApi();
  try {
    return await client.invite(org, "member", passkey());
  } finally {
    after();
  }
}

/** Redeem an invitation token. Answers the org it joined, when the node names it. */
export async function redeemInvitation(token: string): Promise<string | null> {
  const { client, after } = getApi();
  try {
    const redeemed = await client.redeemInvite(token);
    for (const key of ["org", "orgId"]) {
      const v = (redeemed as Record<string, unknown>)[key];
      if (typeof v === "string" && v) return v;
    }
    return null;
  } finally {
    after();
  }
}

// ── Members of a team ────────────────────────────────────────────────────────

/** The parts of `GET /orgs/{org}` the screens read. */
export interface TeamRecord {
  name: string;
  /** account -> `owner` | `admin` | `member` | `guest`. */
  roles: Map<string, string>;
  /** account -> the name they set for the team, where one is set. */
  names: Map<string, string>;
}

export async function readTeam(org: string): Promise<TeamRecord> {
  const { client, after } = getApi();
  try {
    const o = (await client.getOrg(org)) as Record<string, unknown>;
    const members = (o.members ?? {}) as Record<string, string>;
    const meta = (o.memberMetadata ?? {}) as Record<string, unknown>;
    const names = new Map<string, string>();
    for (const [account, value] of Object.entries(meta)) {
      const name = (value as { name?: unknown } | null)?.name;
      if (typeof name === "string" && name.trim()) names.set(account, name.trim());
    }
    return { name: typeof o.name === "string" ? o.name : "", roles: new Map(Object.entries(members)), names };
  } finally {
    after();
  }
}

/** Publishes the name `account` goes by across the team (org member metadata). */
export async function setTeamName(org: string, account: string, name: string): Promise<void> {
  const { client, after } = getApi();
  try {
    await client.setMemberMetadata(org, account, { name });
  } finally {
    after();
  }
}

export interface GroupMemberInfo {
  identity: string;
  /** `Admin` (the org's owner or an admin) or `Member` (a member or a guest). */
  role: string;
  /** The org's owner: never demoted or removed from here. */
  owner?: boolean;
  name?: string;
}

/** The team's members, by account, with the screen's two roles. */
export async function listGroupMembers(org: string): Promise<{ members: GroupMemberInfo[] }> {
  const team = await readTeam(org);
  const members = [...team.roles.entries()].map(([identity, role]) => ({
    identity,
    role: isTeamAdminRole(role) ? "Admin" : "Member",
    ...(role === "owner" ? { owner: true } : {}),
    ...(team.names.get(identity) ? { name: team.names.get(identity) } : {}),
  }));
  return { members };
}

/** Promote to admin or demote to member. A passkey step-up. */
export async function updateMemberRole(org: string, account: string, role: "Admin" | "Member"): Promise<void> {
  const { client, passkey, after } = getApi();
  try {
    await client.setMember(org, account, role === "Admin" ? "admin" : "member", passkey());
  } finally {
    after();
  }
}

/** Take someone out of the team. A passkey step-up. */
export async function removeTeamMember(org: string, account: string): Promise<void> {
  const { client, passkey, after } = getApi();
  try {
    await client.removeMember(org, account, passkey());
  } finally {
    after();
  }
}

// ── Boards: app instances ────────────────────────────────────────────────────

export interface BoardEntry {
  /** The app instance id. Called `contextId` across the screens, as in v1. */
  contextId: string;
  /** The team (org) it belongs to. */
  groupId: string;
  name: string;
  /** Who created the instance: it (or a team admin) may delete it. */
  owner: string;
}

/** The instances of this app (the dev bundle, or the package) the account reaches. */
export async function listInstances(client: Pick<CalimeroClient, "listApps">, source: AppSource): Promise<AppInfo[]> {
  const filter = typeof source === "string" ? { bundle: source } : { package: source.package };
  return client.listApps(filter);
}

/** A team's boards, by name. */
export async function listBoards(org: string): Promise<BoardEntry[]> {
  const { client, source, after } = getApi();
  try {
    return (await listInstances(client, source))
      .filter((a) => a.org === org)
      .map((a) => ({ contextId: a.appId, groupId: org, name: a.name, owner: a.owner }))
      .sort((a, b) => a.name.localeCompare(b.name) || a.contextId.localeCompare(b.contextId));
  } finally {
    after();
  }
}

/** Which team a board is in, among the boards this account reaches; null when none. */
export async function teamOfBoard(app: string): Promise<string | null> {
  const { client, source, after } = getApi();
  try {
    return (await listInstances(client, source)).find((a) => a.appId === app)?.org ?? null;
  } finally {
    after();
  }
}

/**
 * A new board in the team: an app instance in the org, named on the contract
 * too (v1's `init` took the name; the component's takes nothing). Answers its id.
 */
export async function createBoard(org: string, name: string): Promise<string> {
  const { client, source, after } = getApi();
  let app: string;
  try {
    app = await client.createApp(name, source, { org });
  } finally {
    after();
  }
  // Best-effort: the instance's own name is what the list shows until then.
  await rpcCall(app, "update_board", { name, description: "" }).catch(() => {});
  return app;
}

/** Deletes the board for everyone (its creator, or a team admin). */
export async function deleteBoard(app: string): Promise<void> {
  const { client, after } = getApi();
  try {
    await client.deleteApp(app);
  } finally {
    after();
  }
}

/** Renames the board for everyone: the contract's name, which every reader prefers. Its owner only. */
export async function renameBoard(app: string, name: string): Promise<void> {
  await rpcCall(app, "update_board", { name, description: null });
}

/** The board's current name on the contract, or "" until its owner set one. */
export async function boardName(app: string): Promise<string> {
  const board = await rpcCall<{ name?: string }>(app, "get_board", {});
  return board?.name?.trim() ?? "";
}

// ── Blobs ────────────────────────────────────────────────────────────────────
//
// An image or SVG is a blob of the board's app instance: uploaded to it, read
// back by any member who reaches it. The element stores the blob's id (its
// SHA-256, hex) as a `BlobRef`: the node keeps the blob while an element refers
// to it, and refuses a write that names a blob the board does not hold. So an
// element that brings a blob from elsewhere (a paste from another board, a
// project file) has its bytes uploaded to this board first; uploading the same
// bytes gives the same id. One whose bytes this browser cannot find is written
// without its blob and shows the "unavailable" placeholder, instead of the
// whole batch being refused.

/** Blob ids each board is known to hold: uploaded to it, read from it, or named by its elements. */
const heldBlobs = new Map<string, Set<string>>();

function heldBy(app: string): Set<string> {
  let set = heldBlobs.get(app);
  if (!set) {
    set = new Set();
    heldBlobs.set(app, set);
  }
  return set;
}

function blobIdOf(el: unknown): string | null {
  const data = (el as { data?: { kind?: string; blobId?: unknown } } | null)?.data;
  if (!data || (data.kind !== "image" && data.kind !== "svg")) return null;
  return typeof data.blobId === "string" && data.blobId ? data.blobId : null;
}

/** Note the blobs a read shows this board holds. */
export function rememberBlobs(app: string, method: string, out: unknown): void {
  if (method !== "get_elements" && method !== "get_elements_by_ids" && method !== "get_element") return;
  const list = Array.isArray(out) ? out : out ? [out] : [];
  for (const el of list) {
    const id = blobIdOf(el);
    if (id) heldBy(app).add(id);
  }
}

/** Whether `app` holds blob `id`, uploading this browser's copy of it when it does not yet. */
async function ensureBlob(app: string, id: string): Promise<boolean> {
  const held = heldBy(app);
  if (held.has(id)) return true;
  try {
    const cached = await getCachedBlob(id);
    if (cached) {
      const { blobId } = await uploadBlob(cached, app);
      return blobId === id;
    }
    await getBlob(id, app); // the board may hold it already: reading it proves so
    return true;
  } catch {
    return false;
  }
}

/**
 * Before `add_element(s)`: every blob the elements name is one the board holds,
 * or the element goes without it (see above). Rewrites `packed` in place; the
 * element objects in it are the adapter's copies, never the store's.
 */
export async function carryBlobs(app: string, method: string, packed: Record<string, unknown>): Promise<void> {
  const fix = async (el: Record<string, unknown>): Promise<Record<string, unknown>> => {
    const id = blobIdOf(el);
    if (!id || (await ensureBlob(app, id))) return el;
    console.warn(`[MeroDesign] blob ${id} is not on this board and no copy was found; the image is added without it`);
    const { blobId: _gone, ...data } = el.data as Record<string, unknown>;
    return { ...el, data };
  };
  if (method === "add_element" && packed.element && typeof packed.element === "object") {
    packed.element = await fix(packed.element as Record<string, unknown>);
  } else if (method === "add_elements" && Array.isArray(packed.elements)) {
    const out: Record<string, unknown>[] = [];
    for (const el of packed.elements as Record<string, unknown>[]) out.push(await fix(el));
    packed.elements = out;
  }
}

export async function uploadBlob(data: ArrayBuffer | Uint8Array, app: string): Promise<{ blobId: string }> {
  if (!app) throw new Error("uploadBlob needs the board's id");
  const { client, after } = getApi();
  try {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    const res = await client.uploadBlob(app, bytes);
    const blobId = res?.id || res?.blobId || "";
    if (blobId) heldBy(app).add(blobId);
    return { blobId };
  } finally {
    after();
  }
}

export async function getBlob(blobId: string, app: string): Promise<ArrayBuffer> {
  const cached = await getCachedBlob(blobId);
  if (cached) return cached;
  if (!app) throw new Error("getBlob needs the board's id");
  const { client, after } = getApi();
  try {
    const bytes = await client.downloadBlob(app, blobId);
    heldBy(app).add(blobId);
    const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    setCachedBlob(blobId, buf); // fire-and-forget, non-blocking
    return buf;
  } finally {
    after();
  }
}
