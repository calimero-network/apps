/**
 * Scoping every namespace and context list to Mero Calendar's own application.
 *
 * A node hosts many applications. `GET /namespaces` and `GET /contexts` are
 * node-wide, so listing them unfiltered shows another app's teams as though
 * they were calendars — and opening one runs the calendar contract's methods
 * against a context whose application is something else entirely, which the
 * node answers with an opaque 500 that never mentions applications.
 *
 * Core does the filtering server-side on
 * `/namespaces/for-application/:id` and `/contexts/for-application/:id`.
 * These helpers are the second line: they re-apply the same predicate to any
 * list that arrived from an unscoped route (an older node missing the scoped
 * one, or a per-group listing), using the very fields the scoped handlers
 * filter on — `targetApplicationId` for a namespace, `applicationId` for a
 * context. Both are unconditionally serialized by core, on the scoped and the
 * unscoped route alike, so the predicate here is the same one core applies.
 *
 * The rule these encode: when Mero Calendar's own application id is unknown we
 * return NOTHING, never everything. An empty teams list reads as "nothing here
 * yet" and costs a refresh; a list of another application's namespaces reads as
 * real teams and dead-ends on a 500 the moment one is opened.
 */

export interface NamespaceRecord {
  namespaceId?: string;
  groupId?: string;
  id?: string;
  name?: string;
  alias?: string;
  targetApplicationId?: string;
  target_application_id?: string;
  applicationId?: string;
  contextCount?: number;
  memberCount?: number;
}

export interface ContextRecord {
  id?: string;
  contextId?: string;
  context_id?: string;
  applicationId?: string;
  application_id?: string;
  groupId?: string;
  group_id?: string;
}

/** The application a namespace targets, "" when the record doesn't say. */
export function namespaceAppId(ns: NamespaceRecord): string {
  return (
    ns.targetApplicationId ??
    ns.target_application_id ??
    ns.applicationId ??
    ""
  ).trim();
}

/** The application a context runs, "" when the record doesn't say. */
export function contextAppId(ctx: ContextRecord): string {
  return (ctx.applicationId ?? ctx.application_id ?? "").trim();
}

export function namespaceId(ns: NamespaceRecord): string {
  return (ns.namespaceId ?? ns.groupId ?? ns.id ?? "").trim();
}

export function contextId(ctx: ContextRecord): string {
  return (ctx.contextId ?? ctx.context_id ?? ctx.id ?? "").trim();
}

/**
 * Keep only the namespaces targeting `appId`.
 *
 * A record that doesn't name an application is DROPPED rather than kept: core
 * always sends the field, so a missing one means the response isn't the shape
 * we think it is — and guessing "probably ours" is how another app's teams get
 * listed. Dropping is visible and recoverable; guessing is neither.
 */
export function namespacesForThisApp(
  all: NamespaceRecord[],
  appId: string | undefined,
): NamespaceRecord[] {
  const id = appId?.trim();
  if (!id) return [];
  return all.filter((ns) => namespaceAppId(ns) === id);
}

/** Keep only the contexts running `appId`; see `namespacesForThisApp`. */
export function contextsForThisApp(
  all: ContextRecord[],
  appId: string | undefined,
): ContextRecord[] {
  const id = appId?.trim();
  if (!id) return [];
  return all.filter((ctx) => contextAppId(ctx) === id);
}
