import { AppError, ORG_CAPABILITIES, TrapError, type AppInfo, type CalimeroClient } from "@calimero-network/mero-js";
import { markOrgFor, myOrgs, orgsWithApp, otherOrgs, type AppSource, type OtherOrg } from "@calimero-apps/connect";
import { setOrgName } from "@calimero-apps/names";
import { getApi } from "./client";
import { toWire } from "./meroDesign";
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
    return { ...args, element: elementToWire(args.element as Element) };
  }
  if (method === "add_elements" && Array.isArray(args.elements)) {
    return { ...args, elements: (args.elements as Element[]).map(elementToWire) };
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
    return value.map((el) => fromWire(el as Element)) as T;
  }
  if (method === "get_element" && value && typeof value === "object") {
    return fromWire(value as unknown as Element) as T;
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

/** Pages `getElementsPage` reads at a time when `get_elements` wants the whole board. */
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
 * Every element on the board in paint order. The component contract answers
 * `getElements` with at most a page (1,000), so a larger board is read page
 * by page through `getElementsPage`, as v1's single read returned it whole.
 */
async function allElements(client: Contract, app: string): Promise<Element[]> {
  const out: Element[] = [];
  let cursor: string | null = null;
  for (;;) {
    const page = (await send(client, app, "get_elements_page", { cursor, limit: ELEMENT_PAGE })) as {
      items?: Element[];
      nextCursor?: string | null;
    };
    out.push(...(page.items ?? []));
    if (!page.nextCursor) return out;
    cursor = page.nextCursor;
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
    const out = method === "get_elements" ? await allElements(client, app) : await send(client, app, method, packed);
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

export interface TeamEntry {
  /** The org id. */
  namespaceId: string;
  name?: string;
  /** `owner` | `admin` | `member` | `guest`. */
  role: string;
}

/**
 * The teams: the orgs this account is in that hold a board or were made for
 * Mero Design. An org made for another app (a Mero Blocks world) is not one,
 * and is never entered on its own: it is offered under "Connect to an
 * existing organization" ({@link listOtherTeams}).
 */
export async function listTeams(): Promise<TeamEntry[]> {
  const { client, source, after } = getApi();
  try {
    const orgs = await orgsWithApp(client, source, { marked: true });
    return orgs.map((o) => ({ namespaceId: o.orgId, name: o.name || undefined, role: o.role }));
  } finally {
    after();
  }
}

/** The account's other orgs, where boards may be added, with what each holds. */
export async function listOtherTeams(): Promise<OtherOrg[]> {
  const { client, source, after } = getApi();
  try {
    return await otherOrgs(client, source);
  } finally {
    after();
  }
}

/** The board created in an org the account connects to Mero Design. */
export const CONNECTED_BOARD_NAME = "Untitled board";

/** The caller's role in `org` (any org it is in), or null when not in it. */
export async function myTeamRole(org: string): Promise<string | null> {
  const { client, after } = getApi();
  try {
    return (await myOrgs(client)).find((o) => o.orgId === org)?.role ?? null;
  } finally {
    after();
  }
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
  const { client, source, passkey, after } = getApi();
  try {
    const namespaceId = await client.createOrg(name);
    // Listed as a team before it holds a board.
    await markOrgFor(client, namespaceId, source);
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

/**
 * Publishes the name `account` goes by across the team (org member metadata),
 * keeping the rest of its member record, and remembers it to offer when the
 * next team asks.
 */
export async function setTeamName(org: string, account: string, name: string): Promise<void> {
  const { client, after } = getApi();
  try {
    await setOrgName(client, org, account, name);
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
// back by any member who reaches it. The element stores the blob's hex id.

export async function uploadBlob(data: ArrayBuffer | Uint8Array, app: string): Promise<{ blobId: string }> {
  if (!app) throw new Error("uploadBlob needs the board's id");
  const { client, after } = getApi();
  try {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    const res = await client.uploadBlob(app, bytes);
    return { blobId: res?.id || res?.blobId || "" };
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
    const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    setCachedBlob(blobId, buf); // fire-and-forget, non-blocking
    return buf;
  } finally {
    after();
  }
}
