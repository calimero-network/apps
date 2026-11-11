import { passkeyConfirm, type AppInfo, type PasskeyProvider } from "@calimero-network/mero-js";
import {
  appTarget,
  createInviteStore,
  inviteLink,
  listAppInfos,
  targetKey,
  type AppSource,
  type ClientRoutes,
  type InviteStore,
  type KeyValueStorage,
  type PendingInvite,
  type Target,
} from "@calimero-apps/connect";
import { nodeBasename } from "@calimero-apps/node-served";

import { APP } from "./session";

/**
 * A table is an app instance: v1's context. Tables live in an organization
 * (v1's namespace, the "club"), whose members reach every table in it, so one
 * invitation lets an opponent into all of them.
 */

/** The tables the account reaches: of the dev bundle, or of the package. */
export async function listTables(client: ClientRoutes<{ apps: "list" }>, source: AppSource): Promise<AppInfo[]> {
  const filter = typeof source === "string" ? { bundle: source } : { package: source.package };
  const apps = await listAppInfos(client, filter);
  return [...apps].sort((a, b) => a.name.localeCompare(b.name) || a.appId.localeCompare(b.appId));
}

/**
 * A new table named `name`. In `org` when given (v1: another context in a
 * namespace you have), otherwise in a new organization of its own (v1's "New
 * table" made a namespace and a context in it). `now` is the creator's clock,
 * the table's `createdAt`.
 */
export async function createTable(
  client: ClientRoutes<{ apps: "create"; orgs: "create" }>,
  source: AppSource,
  name: string,
  org?: string,
  now: number = Date.now(),
): Promise<{ appId: string; org: string }> {
  const inOrg = org ?? (await client.orgs.create({ name })).orgId;
  const appId = (
    await client.apps.create({
      name,
      ...appTarget(source),
      org: inOrg,
      initArgs: { title: name, now: String(Math.floor(now)) },
    })
  ).appId;
  return { appId, org: inOrg };
}

/** An invitation into `org` as a member, approved with the inviter's passkey (412 step-up). */
export function inviteToken(
  client: ClientRoutes<{ orgs: "inviteCreate" }>,
  org: string,
  passkey: PasskeyProvider,
): Promise<string> {
  return client.orgs
    .inviteCreate({ org, role: "member", teams: [] }, { confirm: passkeyConfirm(passkey) })
    .then((r) => r.token);
}

/**
 * Where this frontend's routes live: `/`, or under the node's `/{version}/`.
 * A version-pinned invite link's route is read relative to it.
 */
export const basename = (): string => nodeBasename(new URL(window.location.href), "/");

/** The link parameter naming the table an invite opens. */
const TABLE_PARAM = "table";
/** The link parameter naming who sent it: "Join {from}'s game as ...?". */
const FROM_PARAM = "from";

/**
 * This app's pending invite (`createInviteStore` in `@calimero-apps/connect`),
 * with the table its link names (`&table=`) and who sent it (`&from=`):
 * captured in `main.tsx` before React mounts, then bound to the cluster, held
 * for the account that signs in with it and dropped on sign-out by the passkey
 * session (`usePasskeySession({ invites })`).
 */
export const invites: InviteStore = createInviteStore(APP, { keep: [TABLE_PARAM, FROM_PARAM] });

/** The table a pending invite's link names, opened once it is redeemed. */
export function invitedTable(invite: PendingInvite | null): string | null {
  return invite?.extra[TABLE_PARAM] ?? null;
}

/** Who sent a pending invite, as their link names them; `null` for a link that does not. */
export function inviter(invite: PendingInvite | null): string | null {
  return invite?.extra[FROM_PARAM] ?? null;
}

/**
 * The link that opens this frontend with `token` to redeem and `table` to open
 * after. It also names `org` (redeeming spends the link's single use even for
 * someone already in the org, so the app tells a member first) and `from`, the
 * inviter's name, for the question the invitee is asked.
 *
 * Pinned to the router's basename (the served `/{version}/`) until every
 * cluster keeps the query on its root redirect (core's served-redirect fix).
 */
export function tableInviteLink(token: string, table: string, org: string, from?: string | null): string {
  return inviteLink(token, { org, root: basename(), extra: { [TABLE_PARAM]: table, [FROM_PARAM]: from } });
}

/** The key this app kept its pending invite under before the shared store: `{ token, table }`. */
const LEGACY_INVITE = `${APP}:pending-invite`;

/**
 * Moves an invite stored by an older build of this app into `store`, unless
 * the store holds one already (a link opened just now wins), and forgets the
 * old key.
 */
export function migrateStoredInvite(
  store: InviteStore,
  storage: KeyValueStorage | undefined = globalThis.localStorage,
): void {
  if (!storage) return;
  let raw: string | null;
  try {
    raw = storage.getItem(LEGACY_INVITE);
  } catch {
    return;
  }
  if (raw && !store.pending()) {
    try {
      const old = JSON.parse(raw) as { token?: unknown; table?: unknown };
      if (typeof old.token === "string" && old.token) {
        store.put({
          token: old.token,
          org: null,
          team: null,
          doc: null,
          route: null,
          extra: typeof old.table === "string" && old.table ? { [TABLE_PARAM]: old.table } : {},
        });
      }
    } catch {
      /* not an invite */
    }
  }
  try {
    storage.removeItem(LEGACY_INVITE);
  } catch {
    /* nothing stored */
  }
}

const DEFERRED = `${APP}:invite-deferred`;

/**
 * "Not now" on the signed-out invitation page: the ordinary landing page for
 * the rest of this tab, with the token KEPT, so signing in later still asks.
 */
export function deferInvite(storage: Pick<Storage, "setItem"> = sessionStorage): void {
  try {
    storage.setItem(DEFERRED, "1");
  } catch {
    /* the page still moves on for this render */
  }
}

export function inviteDeferred(storage: Pick<Storage, "getItem"> = sessionStorage): boolean {
  try {
    return storage.getItem(DEFERRED) === "1";
  } catch {
    return false;
  }
}

/** A new link was opened: its invitation page shows again. */
export function dropDeferral(storage: Pick<Storage, "removeItem"> = sessionStorage): void {
  try {
    storage.removeItem(DEFERRED);
  } catch {
    /* nothing stored */
  }
}

/**
 * The table to open in `org` (the one an invite joined, or the account was
 * already in): the table the link named when the account reaches it, else
 * `prefer` (the one opened last) when it is in `org`, else the first by name.
 * `null` when the account reaches none there yet.
 */
export function tableIn(
  tables: AppInfo[],
  org: string | null,
  named?: string | null,
  prefer?: string | null,
): AppInfo | null {
  const asked = named ? tables.find((a) => a.appId === named) : undefined;
  if (asked) return asked;
  if (!org) return null;
  const inOrg = tables.filter((a) => a.org === org);
  return inOrg.find((a) => a.appId === prefer) ?? inOrg[0] ?? null;
}

/** The table last opened on this target by this account, remembered across loads. */
export function selectionKey(target: Target, accountId: string): string {
  return `${APP}:table:${targetKey(target)}:${accountId}`;
}
