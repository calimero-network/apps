/**
 * Who reaches an app instance: its **grants** (core 1.0.0-rc.33, core#5194).
 *
 * An instance's access is a list of grants, each one way in; none is its owner
 * alone. `POST /apps` takes `grants` (absent: `[{ kind: "org" }]`), `POST
 * /apps/{app}/access` replaces them, and `GET /apps/{app}` and a move answer
 * them. The single `access` mode before it (`owner`, `org`, `accounts`,
 * `team`, `public`) is gone both ways: core refuses a request still carrying
 * it (`400 ACCESS_REMOVED`) and answers no `access`.
 *
 * | before (`access`) | now (`grants`) |
 * |---|---|
 * | `owner` | `[]` |
 * | `org` | `[{ kind: "org" }]` |
 * | `accounts { accounts }` | one `{ kind: "account", account }` each |
 * | `team { team }` | `[{ kind: "team", team }]` |
 * | `public` | `[{ kind: "anyone" }]`: any **signed-in** account; nobody signed out |
 *
 * mero-js types `grants` on every one of those routes (its `Grant` schema), so
 * an instance is made with `client.apps.create({ ..., grants })` and its grants
 * replaced with `client.apps.access({ app, grants })`; this module only reads
 * and builds them.
 */
import type { ApiComponents } from "@calimero-network/mero-js";

/**
 * A grant as an instance's record answers it (mero-js's `Grant`): `org`, `team`,
 * `account` (with an optional `scope`, the app's own JSON of at most 256 bytes),
 * `anyone` (any signed-in account; never a caller without one), or a public
 * link (core#5195), which has its own routes and is never sent through `grants`.
 */
export type ReadGrant = ApiComponents["schemas"]["Grant"];

/** One way into an instance, as `POST /apps` and `POST /apps/{app}/access` take it: any grant but a link. */
export type Grant = Exclude<ReadGrant, { kind: "link" }>;

/** An instance's grants from its record (`GET /apps/{app}`, a move's answer); `[]` for none or a malformed one. */
export function grantsOf(record: unknown): ReadGrant[] {
  const raw = (record as { grants?: unknown } | null | undefined)?.grants;
  if (!Array.isArray(raw)) return [];
  const out: ReadGrant[] = [];
  for (const g of raw as unknown[]) {
    const v = (g ?? {}) as { kind?: unknown; team?: unknown; account?: unknown; scope?: unknown };
    switch (v.kind) {
      case "org":
      case "anyone":
        out.push({ kind: v.kind });
        break;
      case "team":
        if (typeof v.team === "string" && v.team) out.push({ kind: "team", team: v.team });
        break;
      case "account":
        if (typeof v.account === "string" && v.account) {
          out.push(v.scope === undefined ? { kind: "account", account: v.account } : { kind: "account", account: v.account, scope: v.scope });
        }
        break;
      case "link":
        out.push({ ...(g as Record<string, unknown>), kind: "link" } as ReadGrant);
        break;
      default:
        break;
    }
  }
  return out;
}

/** The teams the grants admit, in order. */
export function grantedTeams(grants: readonly ReadGrant[]): string[] {
  return grants.flatMap((g) => (g.kind === "team" ? [g.team] : []));
}

/**
 * The team an instance is on: its one team grant, with no organization grant
 * beside it (core allows none). `null` with no team grant or several.
 */
export function grantedTeam(grants: readonly ReadGrant[]): string | null {
  const teams = grantedTeams(grants);
  return teams.length === 1 ? teams[0]! : null;
}

/** The accounts named by account grants (named members and guests), in order. */
export function grantedAccounts(grants: readonly ReadGrant[]): string[] {
  return grants.flatMap((g) => (g.kind === "account" ? [g.account] : []));
}

/** Whether the grants admit every member of the instance's organization. */
export function grantsOrg(grants: readonly ReadGrant[]): boolean {
  return grants.some((g) => g.kind === "org");
}

/** Whether the grants admit any signed-in account (`anyone`; never someone signed out). */
export function grantsAnyone(grants: readonly ReadGrant[]): boolean {
  return grants.some((g) => g.kind === "anyone");
}

/** One account grant per account (deduplicated), each with `scope` when given. */
export function accountGrants(accounts: readonly string[], scope?: unknown): Grant[] {
  return [...new Set(accounts.filter(Boolean))].map((account) =>
    scope === undefined ? { kind: "account", account } : { kind: "account", account, scope },
  );
}

/** Where {@link grantPeople} reads a group's people. */
export interface GrantPeopleSources {
  /** Every member the organization grant admits (e.g. no guest once the org has app teams). */
  org?: () => readonly string[];
  /** The people of a team. */
  team?: (team: string) => readonly string[];
}

/**
 * Who reaches an instance, as far as its grants name people: its owner, the
 * accounts it names, and the people of its organization and teams where
 * `sources` reads them. `anyone` (every signed-in account) and links name
 * nobody in particular and add no one; test {@link grantsAnyone} for that.
 */
export function grantPeople(owner: string | null | undefined, grants: readonly ReadGrant[], sources: GrantPeopleSources = {}): string[] {
  const out = new Set<string>();
  if (owner) out.add(owner);
  for (const g of grants) {
    if (g.kind === "account") out.add(g.account);
    else if (g.kind === "org") for (const a of sources.org?.() ?? []) out.add(a);
    else if (g.kind === "team") for (const a of sources.team?.(g.team) ?? []) out.add(a);
  }
  return [...out];
}
