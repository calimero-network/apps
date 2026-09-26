/**
 * Telling "this context is still warming up" apart from "this context is broken".
 *
 * ── The bug this exists for ──────────────────────────────────────────────────
 *
 * Joining a workspace produced a burst of ~20 error toasts reading
 * "context state not initialized, awaiting state sync". A join is several round
 * trips — the namespace grant, the context replicating, an identity landing —
 * and every read fired during that window fails until the context's root hash is
 * non-zero. Core is explicit that this is a WAIT, not a failure:
 *
 *   crates/context/src/handlers/execute/mod.rs
 *     if !is_state_op && *context.meta.root_hash == [0; 32] {
 *         return ActorResponse::reply(Err(ExecuteError::Uninitialized));
 *     }
 *
 *   crates/context/primitives/src/messages.rs
 *     #[error("context state not initialized, awaiting state sync")]
 *     Uninitialized,
 *     #[error("group key not yet delivered for context '{context_id}' — retry shortly")]
 *     GroupKeyPending { context_id: ContextId },
 *
 * `GroupKeyPending` is included because it is the same situation wearing a
 * different hat — core's own comment calls it "a transient retry-able
 * condition", and it lands in exactly the same window, when the group key has
 * not yet arrived over gossip.
 *
 * ── Why this is a NARROW matcher, deliberately ───────────────────────────────
 *
 * The naive fix for a noisy toast is to stop showing read errors. That turns a
 * genuinely broken context — wrong application id, a context that will never
 * sync, a contract that actually failed — into a silent empty page, which is
 * strictly worse than the noise. So this matches those two conditions and
 * nothing else, by the serde tag core sends (`#[serde(tag = "type")]`) and by
 * the exact message strings above. Everything else is a real error and is
 * surfaced immediately.
 *
 * And even a match is only ever a REPRIEVE, not an exemption: `useCrm` starts
 * a clock on the first one and promotes it to a real error if it does not clear
 * (see `WARMUP_GRACE_MS`). A context stuck uninitialized forever is a genuine
 * fault and has to be reportable.
 */
import { describeError } from './errors';

/** The serde `type` tags core sends for the two transient execute failures. */
const TRANSIENT_TAGS = new Set(['uninitialized', 'groupkeypending']);

/**
 * Phrases from core's `#[error(...)]` strings. Matched in full rather than on
 * the word "uninitialized" alone, so an unrelated message that happens to
 * contain it is not mistaken for a join in progress.
 */
const TRANSIENT_PHRASES = [
  'context state not initialized',
  'awaiting state sync',
  'group key not yet delivered',
];

/** Walk an error-ish value for a `type`/`kind` field naming a transient tag. */
function hasTransientTag(value: unknown, depth = 0): boolean {
  if (depth > 4 || value == null || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  for (const key of ['type', 'kind', 'name']) {
    const tag = v[key];
    if (typeof tag === 'string' && TRANSIENT_TAGS.has(tag.trim().toLowerCase())) {
      return true;
    }
  }
  return (
    hasTransientTag(v.data, depth + 1) ||
    hasTransientTag(v.error, depth + 1) ||
    hasTransientTag(v.cause, depth + 1)
  );
}

/**
 * True when this error means "the context is not ready YET" rather than
 * "the call failed".
 *
 * Reads through `describeError` as well as the raw object, because the node
 * delivers contract failures as an ASCII byte array inside a wrapper string —
 * the phrase is not in `err.message` until that has been decoded.
 */
export function isContextWarmingUp(err: unknown): boolean {
  if (err == null) return false;
  if (hasTransientTag(err)) return true;

  const haystack: string[] = [];
  try {
    haystack.push(describeError(err));
  } catch { /* fall back to the raw forms below */ }
  if (typeof err === 'string') haystack.push(err);
  const e = err as { message?: unknown };
  if (typeof e?.message === 'string') haystack.push(e.message);
  try {
    haystack.push(JSON.stringify(err) ?? '');
  } catch { /* circular or otherwise unserialisable — the above is enough */ }

  const text = haystack.join('  ').toLowerCase();
  if (TRANSIENT_PHRASES.some((phrase) => text.includes(phrase))) return true;

  // The bare serde tag, as it appears in a stringified payload
  // (`{"type":"Uninitialized"}`) when nothing else decoded it.
  return /"(?:type|kind)"\s*:\s*"(?:uninitialized|groupkeypending)"/i.test(text);
}

/**
 * How long a context may stay un-initialised before it stops being "joining"
 * and starts being a fault worth reporting.
 *
 * Generous on purpose: a cold join waits on the namespace grant, context
 * replication AND the group key arriving over gossip, and core gives that last
 * one several seconds on its own. Too short and a slow-but-healthy join shows
 * the error the burst fix exists to remove; too long and a genuinely dead
 * context looks like an empty board. Thirty seconds is past any join observed in
 * this repo's two-node e2e and well short of a person's patience.
 */
export const WARMUP_GRACE_MS = 30_000;

/**
 * How long to wait after a sync event before reading.
 *
 * A join delivers a burst of sync events — each one previously triggered its own
 * pair of RPC reads, which is where twenty failures (and twenty toasts) came
 * from. Coalescing them means the burst costs one read, taken once it has
 * settled rather than once per event.
 */
export const SYNC_COALESCE_MS = 250;

/** How often to re-try while the context is still warming up. */
export const WARMUP_RETRY_MS = 1_500;

/** What a failed read means, once the warm-up clock is taken into account. */
export interface ReadOutcome {
  /** Reported to the user. Null while a warm-up is still within its grace. */
  error: Error | null;
  /** The context is syncing; show "syncing", not "empty" and not a failure. */
  warmingUp: boolean;
  /** When the warm-up started, to carry into the next call. Null once over. */
  warmingSince: number | null;
}

/**
 * Decide what a read failure means — the whole suppression rule, in one pure
 * function so it can be tested without a node or a render.
 *
 * `warmingSince` is the clock: null when no warm-up is in progress, otherwise
 * the timestamp of the first transient failure in the current run.
 *
 * The rule:
 *   - not a transient condition        -> report it, immediately, unchanged;
 *   - transient, within the grace      -> report NOTHING, flag `warmingUp`;
 *   - transient, past the grace        -> report it. A context that never
 *     initialises is a real fault, and an eternally silent board is worse than
 *     the toast storm this whole change exists to remove.
 */
export function classifyReadError(
  err: unknown,
  warmingSince: number | null,
  now: number = Date.now(),
): ReadOutcome {
  const error = err instanceof Error ? err : new Error(String(err));

  if (!isContextWarmingUp(err)) {
    return { error, warmingUp: false, warmingSince: null };
  }

  const since = warmingSince ?? now;
  const expired = now - since > WARMUP_GRACE_MS;
  return {
    error: expired ? error : null,
    warmingUp: true,
    warmingSince: since,
  };
}
