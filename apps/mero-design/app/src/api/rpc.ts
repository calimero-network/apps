import { passkeyConfirm, AppError, ORG_CAPABILITIES, TrapError, type AppInfo } from "@calimero-network/mero-js";
import {
  appInvite,
  appPeople,
  appTarget,
  createAppOrg,
  isAppOnly,
  leaveApp,
  leaveOrg,
  listAppInfos,
  myOrgs,
  orgInstanceOptions,
  orgsWithApp,
  otherOrgs,
  removeFromApp,
  sourcePackage,
  type AppInviteToken,
  type AppOrgView,
  type AppSource,
  type ClientRoutes,
  type LeftApp,
  type OtherOrg,
} from "@calimero-apps/connect";
import { setOrgName } from "@calimero-apps/names";
import { getApi, peekApi } from "./client";
import { MeroDesignClient, type AppTransport, type Element as WireElement } from "../generated/client";
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
 *
 * The org gets this app's own **app team** (core#4890), through
 * `@calimero-apps/connect`'s org-app module: a new team's is open (everyone in
 * the org has the app), boards use team access on it, invites name it, and
 * the member list is its people. Once an admin keeps the org's apps apart in
 * Calimero Home (`shared`), an invite gives Mero Design only, and Remove and
 * Leave take someone out of Mero Design, not out of the org (leaving the last
 * app offers the org too). An org without one (made before app teams, a node
 * without them, a raw dev bundle) is legacy, as before.
 */

/** The app's name where an owner or admin is told who may add it, and in invite notes. */
export const PRODUCT_NAME = "Mero Design";

// ── Contract calls ───────────────────────────────────────────────────────────
//
// The board's contract is called through `MeroDesignClient`
// (`src/generated/client.ts`, which `mero-app-build codegen` writes from
// `logic/res/abi.json`): `design(board).updateElement({ id, strokeWidth,
// updatedAt: i64(now) })`. Its arguments are the ABI's (camelCase, 64-bit
// integers as decimal strings, `i64` below). Its answers are v1's shapes
// unchanged: the element, member, comment and cursor types are plain serde
// structs, whose 64-bit fields stay JSON numbers, which the contract marks
// `#[abi(plain)]` so the generated types describe them. Members and cursors
// read straight into `types/`; an element (whose `data` the app keeps as one
// loose object) and a comment (whose `replies` the ABI leaves optional, as old
// rows may lack them) are cast where they are read.
//
// What the wire still needs around the class lives here: the element extras
// folded into `label` (`wireElement`, `wireLabel`, `wireLabels`, and
// `readElements` / `readElementsByIds` unfolding them), the whole board read
// page by page (`readElements`), and a refusal in the contract's own words
// (`callFailure`).

/**
 * A 64-bit integer argument as the contract takes it: a decimal string. A
 * value that is not a whole number is an error here rather than a `BadArgs`
 * from the node.
 */
export function i64(value: number | bigint | string): string {
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value).toString();
  if (typeof value === "string" && /^-?\d+$/.test(value)) return value;
  throw new Error(`must be an integer, got ${JSON.stringify(value)}`);
}

/** {@link i64}, keeping "not given" (`null`). */
export function optI64(value: number | bigint | string | null | undefined): string | null {
  return value === null || value === undefined ? null : i64(value);
}

/**
 * An element as the contract stores it: the client-side extras folded into
 * `label`. The app's `Element` is looser than the contract's (its `data` is
 * one object with every kind's fields optional), so this is where it becomes
 * the generated type.
 */
export function wireElement(element: Element): WireElement {
  return elementToWire(element) as WireElement;
}

/**
 * A label as `updateElementLabel` takes it: with the element's extras folded
 * in, so a rename never strips its dash style or sticky-ness. The element is
 * looked up in the store; a caller that is changing the extras themselves
 * passes the updated element, because the store write it just made may not be
 * the one this reads.
 */
export function wireLabel(id: string, label: string | null | undefined, element?: Element): string | null {
  const source = element ?? useCanvasStore.getState().elements.find((e) => e.id === id);
  const plain = label ?? null;
  return source ? packLabel(plain, metaOf(source)) : plain;
}

/** Labels as `updateElementLabels` takes them: {@link wireLabel} for each, one store lookup. */
export function wireLabels(labels: readonly { id: string; label?: string | null }[]): { id: string; label: string | null }[] {
  const byId = new Map(useCanvasStore.getState().elements.map((e) => [e.id, e] as const));
  return labels.map(({ id, label }) => {
    const source = byId.get(id);
    const plain = label ?? null;
    return { id, label: source ? packLabel(plain, metaOf(source)) : plain };
  });
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

/** Rethrows a failed request as {@link callFailure}. */
function rethrow(err: unknown): never {
  throw callFailure(err);
}

/**
 * The session's client, read when a request is made (most of this app's calls
 * are fired from plain functions: fabric handlers, the batch helpers, the
 * project importer), with every failure as {@link callFailure}.
 */
const transport: AppTransport = {
  apps: {
    call: async (args, options) => getApi().client.apps.call(args, options).catch(rethrow),
    view: async (args, options) => getApi().client.apps.view(args, options).catch(rethrow),
  },
  events: (app, from, signal) => getApi().client.events(app, from, signal),
};

/** The contract of the board `app` (an app instance id), through the signed-in client. */
export function design(app: string): MeroDesignClient {
  return new MeroDesignClient(transport, app, { after: () => peekApi()?.after() });
}

/** Pages `getElementsPage` reads at a time when the whole board is wanted. */
const ELEMENT_PAGE = 1000;

/**
 * Every element on the board in paint order, unpacked. The contract answers
 * `getElements` with at most a page (1,000), so the board is read page by page
 * through `getElementsPage`, as v1's single read returned it whole.
 */
export async function readElements(board: MeroDesignClient): Promise<Element[]> {
  const out: Element[] = [];
  let cursor: string | null = null;
  for (;;) {
    const page = (await board.getElementsPage({ cursor, limit: ELEMENT_PAGE })) as {
      items?: Element[];
      nextCursor?: string | null;
    };
    out.push(...(page.items ?? []).map(fromWire));
    if (!page.nextCursor) return out;
    cursor = page.nextCursor;
  }
}

/** The current copy of each id that still exists, unpacked; `null` when the contract answered none. */
export async function readElementsByIds(board: MeroDesignClient, ids: string[]): Promise<Element[] | null> {
  const got = (await board.getElementsByIds({ ids })) as Element[] | null;
  return Array.isArray(got) ? got.map(fromWire) : got;
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
    // The org, marked so it is listed as a team before it holds a board, its
    // member defaults, and this app's own team, open (declined, or an older
    // node: a legacy org).
    const made = await createAppOrg(client, name, source, passkey, { capabilities: MEMBER_DEFAULTS });
    if (!made.capabilitiesError) return { namespaceId: made.orgId };
    return {
      namespaceId: made.orgId,
      warning: "The team was created, but people you invite will not be able to create boards or invite others.",
    };
  } finally {
    after();
  }
}

/** Deletes the org and every board in it, for everyone. Its owner only; a passkey step-up. */
export async function deleteTeam(org: string): Promise<void> {
  const { client, passkey, after } = getApi();
  try {
    await client.orgs.delete({ org }, { confirm: passkeyConfirm(passkey()) });
  } finally {
    after();
  }
}

/**
 * Leave a team (a passkey step-up). In an org that keeps its apps apart that
 * is Mero Design only, with `lastApp` set when it was your last app there
 * (offer {@link leaveTeamOrg}); elsewhere the organization.
 */
export async function leaveTeam(org: string): Promise<LeftApp> {
  const { client, source, passkey, accountId, after } = getApi();
  try {
    return await leaveApp(client, org, source, passkey, { self: accountId });
  } finally {
    after();
  }
}

/** Leave the organization altogether, every app in it. A passkey step-up. */
export async function leaveTeamOrg(org: string): Promise<void> {
  const { client, passkey, accountId, after } = getApi();
  try {
    await leaveOrg(client, org, passkey, accountId);
  } finally {
    after();
  }
}

/**
 * An invitation into `org` as a member, approved with the inviter's passkey,
 * naming this app's team (`appInvite`): `appOnly` when it gives Mero Design
 * only (an org that keeps its apps apart). Org-wide in a legacy org.
 */
export async function createTeamInvitation(org: string): Promise<AppInviteToken> {
  const { client, source, passkey, after } = getApi();
  try {
    return await appInvite(client, org, source, passkey);
  } finally {
    after();
  }
}

/** Redeem an invitation token. Answers the org it joined, when the node names it. */
export async function redeemInvitation(token: string): Promise<string | null> {
  const { client, after } = getApi();
  try {
    const redeemed = await client.orgs.inviteRedeem({ token });
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
  /** Who has Mero Design in the team, in org order: its app team, else the org (no guest once it has app teams). */
  people: string[];
  /** The org keeps its apps apart and Mero Design has its team: invites, Remove and Leave are its only. */
  appOnly: boolean;
}

export async function readTeam(org: string): Promise<TeamRecord> {
  const { client, source, after } = getApi();
  try {
    const o = (await client.orgs.get({ org })) as Record<string, unknown>;
    const pkg = sourcePackage(source);
    const members = (o.members ?? {}) as Record<string, string>;
    const meta = (o.memberMetadata ?? {}) as Record<string, unknown>;
    const names = new Map<string, string>();
    for (const [account, value] of Object.entries(meta)) {
      const name = (value as { name?: unknown } | null)?.name;
      if (typeof name === "string" && name.trim()) names.set(account, name.trim());
    }
    return {
      name: typeof o.name === "string" ? o.name : "",
      roles: new Map(Object.entries(members)),
      names,
      people: appPeople(o as AppOrgView, pkg),
      appOnly: isAppOnly(o as AppOrgView, pkg),
    };
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

/** The team's members (who has Mero Design in it), by account, with the screen's two roles. */
export async function listGroupMembers(org: string): Promise<{ members: GroupMemberInfo[]; appOnly: boolean }> {
  const team = await readTeam(org);
  const members = team.people.map((identity) => [identity, team.roles.get(identity) ?? "member"] as const).map(([identity, role]) => ({
    identity,
    role: isTeamAdminRole(role) ? "Admin" : "Member",
    ...(role === "owner" ? { owner: true } : {}),
    ...(team.names.get(identity) ? { name: team.names.get(identity) } : {}),
  }));
  return { members, appOnly: team.appOnly };
}

/** Promote to admin or demote to member. A passkey step-up. */
export async function updateMemberRole(org: string, account: string, role: "Admin" | "Member"): Promise<void> {
  const { client, passkey, after } = getApi();
  try {
    await client.orgs.setMember(
      { org, account, role: role === "Admin" ? "admin" : "member" },
      { confirm: passkeyConfirm(passkey()) },
    );
  } finally {
    after();
  }
}

/**
 * Take someone out of the team (`removeFromApp`, a passkey step-up): in an org
 * that keeps its apps apart, out of Mero Design only, never out of the org;
 * elsewhere out of the org, as before.
 */
export async function removeTeamMember(org: string, account: string): Promise<"app" | "org"> {
  const { client, source, passkey, after } = getApi();
  try {
    return await removeFromApp(client, org, source, account, passkey);
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
export async function listInstances(client: ClientRoutes<{ apps: "list" }>, source: AppSource): Promise<AppInfo[]> {
  const filter = typeof source === "string" ? { bundle: source } : { package: source.package };
  return listAppInfos(client, filter);
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
  const { client, source, passkey, after } = getApi();
  let app: string;
  try {
    // On this app's team (made first, by an owner or admin, in an org whose
    // other apps have teams), or organization access in a legacy org.
    app = (
      await client.apps.create({
        name,
        ...appTarget(source),
        ...(await orgInstanceOptions(client, org, source, passkey, PRODUCT_NAME)),
      })
    ).appId;
  } finally {
    after();
  }
  // Best-effort: the instance's own name is what the list shows until then.
  await design(app).updateBoard({ name, description: "" }).catch(() => {});
  return app;
}

/** Deletes the board for everyone (its creator, or a team admin). */
export async function deleteBoard(app: string): Promise<void> {
  const { client, after } = getApi();
  try {
    await client.apps.delete({ app });
  } finally {
    after();
  }
}

/** Renames the board for everyone: the contract's name, which every reader prefers. Its owner only. */
export async function renameBoard(app: string, name: string): Promise<void> {
  await design(app).updateBoard({ name, description: null });
}

/** The board's current name on the contract, or "" until its owner set one. */
export async function boardName(app: string): Promise<string> {
  const board = await (design(app).getBoard() as Promise<{ name?: string }>);
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
    const res = await client.apps.blobUpload({ app, body: bytes, contentType: "application/octet-stream" });
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
