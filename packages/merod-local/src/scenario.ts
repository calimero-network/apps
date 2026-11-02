/**
 * The neutral scenario format of core's `calimero_app_sdk::testing::scenario`
 * (`crates/app-sdk/src/testing/scenario.rs` at the pinned tag), the parts a
 * cluster can run. The same `scenarios/*.json` an app's `cargo test` runs in the
 * harness are run here on `merod local`, through mero-js, as real accounts.
 *
 * Pure functions only: the cluster side is in `e2e.ts`.
 */

export interface Step {
  as?: string;
  op: string;
  method?: string;
  args?: unknown;
  expect?: Record<string, unknown>;
  events?: Record<string, string[]>;
  save?: string;
  confirmed?: boolean;
}

/** `<name>.org.json`: who the org holds besides the owner, and who it does not. */
export interface OrgSpec {
  admins?: string[];
  members?: string[];
  guests?: string[];
  /** Accounts that exist but are not in the org (refused `NOT_FOUND`). */
  outsiders?: string[];
  teams?: Record<string, string[]>;
  /**
   * Blobs the app holds before the first step (label → UTF-8 content), as a
   * client would have uploaded them. A blob's id is the SHA-256 of its bytes,
   * so steps name each one by that hex digest.
   */
  blobs?: Record<string, string>;
}

/** The result of one step: what the node answered, or what it threw. */
export type Outcome = { ok: true; value: unknown } | { ok: false; error: unknown };

const VAR = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Why a scenario cannot run on a cluster, or `null` when it can. The harness
 * controls time and the system caller; a cluster does not.
 */
export function unsupported(steps: Step[], org: OrgSpec): string | null {
  for (const [n, step] of steps.entries()) {
    if (step.op === "tick") return `step ${n} ticks a timer (harness only: the cluster's own clock drives timers)`;
    if (step.op === "advance") return `step ${n} advances the clock (harness only)`;
    if (step.as === "@system") return `step ${n} calls as the system (harness only)`;
    if (!["call", "view", "removeMember"].includes(step.op)) return `step ${n}: unknown op ${JSON.stringify(step.op)}`;
  }
  if (org.teams && Object.keys(org.teams).length > 0) return "teams are not set up by this runner yet";
  return null;
}

/** Every account a scenario names, owner first, in the order they appear. */
export function accounts(steps: Step[], org: OrgSpec): string[] {
  const seen = new Set<string>(["owner"]);
  const add = (name: string | undefined) => {
    if (name && !name.startsWith("@")) seen.add(name);
  };
  for (const list of [org.admins, org.members, org.guests, org.outsiders]) list?.forEach(add);
  const walk = (value: unknown) => {
    if (typeof value === "string") {
      if (value.startsWith("@") && VAR.test(value.slice(1))) add(value.slice(1));
    } else if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === "object") Object.values(value).forEach(walk);
  };
  for (const step of steps) {
    add(step.as ?? "owner");
    walk(step.args);
    walk(step.expect);
    for (const who of Object.keys(step.events ?? {})) add(who);
    if (step.op === "removeMember" && typeof step.args === "string") add(step.args);
  }
  return [...seen];
}

/**
 * Replaces every string that is exactly `$name` by the saved value and every
 * string that is exactly `@name` by that account's id. Other strings stay.
 */
export function substitute(value: unknown, vars: Map<string, unknown>, accountOf: (name: string) => string): unknown {
  if (typeof value === "string") {
    const name = value.slice(1);
    if (value.startsWith("$") && VAR.test(name)) {
      if (!vars.has(name)) throw new Error(`unknown variable ${value}`);
      return vars.get(name);
    }
    if (value.startsWith("@") && VAR.test(name)) return accountOf(name);
    return value;
  }
  if (Array.isArray(value)) return value.map((v) => substitute(v, vars, accountOf));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, substitute(v, vars, accountOf)]));
  }
  return value;
}

/** JSON with object keys sorted, so two values compare by content. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

function field(error: unknown, key: string): unknown {
  return error && typeof error === "object" ? (error as Record<string, unknown>)[key] : undefined;
}

function show(outcome: Outcome): string {
  if (outcome.ok) return `ok ${canonical(outcome.value)}`;
  const e = outcome.error;
  const code = field(e, "code");
  const app = field(e, "appCode");
  const parts = [field(e, "status"), code, app, app ? canonical(field(e, "fields")) : undefined].filter(
    (p) => p !== undefined && p !== "",
  );
  return parts.length ? `error ${parts.join(" ")}` : `error ${String(e)}`;
}

/** Trap kinds compared without case or separators (`OutOfFuel`, `out_of_fuel`). */
function sameKind(a: unknown, b: unknown): boolean {
  const norm = (v: unknown) => String(v ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  return norm(a) === norm(b);
}

/**
 * Throws when `outcome` is not what `expect` says. No `expect` means the step
 * must succeed, with any result.
 */
export function check(expect: Record<string, unknown> | undefined, outcome: Outcome): void {
  const fail = (want: string) => {
    throw new Error(`expected ${want}, got ${show(outcome)}`);
  };
  if (!expect) {
    if (!outcome.ok) fail("success");
    return;
  }
  if ("ok" in expect) {
    if (!outcome.ok || canonical(outcome.value) !== canonical(expect.ok)) fail(`ok ${canonical(expect.ok)}`);
    return;
  }
  if (outcome.ok) fail(canonical(expect));
  const error = (outcome as { error: unknown }).error;
  if ("error" in expect) {
    if (field(error, "code") !== "APP_ERROR" || field(error, "appCode") !== expect.error) {
      fail(`app error ${String(expect.error)}`);
    }
    if ("fields" in expect && canonical(field(error, "fields")) !== canonical(expect.fields)) {
      fail(`app error ${String(expect.error)} ${canonical(expect.fields)}`);
    }
    return;
  }
  if ("trap" in expect) {
    if (field(error, "code") !== "TRAP") fail(`trap ${String(expect.trap)}`);
    // The harness names the wasmtime trap; a node may only say that the guest
    // trapped. A kind the node does name must match.
    const kind = field(error, "kind");
    if (typeof expect.trap === "string" && kind && !sameKind(kind, expect.trap)) fail(`trap ${expect.trap}`);
    return;
  }
  if ("confirmRequired" in expect) {
    if (field(error, "code") !== "CONFIRM_REQUIRED") fail("CONFIRM_REQUIRED");
    return;
  }
  if ("refused" in expect) {
    if (field(error, "code") !== expect.refused) fail(`refused ${String(expect.refused)}`);
    return;
  }
  throw new Error(`unknown expectation ${canonical(expect)}`);
}
