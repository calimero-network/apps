// ── Checking a 32-byte id before the node has to ──────────────────────────────
//
// Every id core takes over the admin API — application, namespace, context,
// device key, account — is 32 bytes as 64 hex characters since core 0.11.0-rc.27
// removed base58. Send anything else and the node answers with serde's own
// wording, which is what the "Create Namespace" bug report carried verbatim:
//
//     Error: Request failed: Invalid JSON data: Failed to deserialize the JSON
//     body into the target type: applicationId: expected 64 hex characters
//     (32 bytes) at line 1 column 28
//
// That names a JSON column. It does not say what the value was, that it came
// from a text box three lines up, or which of the two easy mistakes produced it.
// This module says all three, before the request is built.
//
// Every other id field in this app already tells the user the shape — see the
// `FieldHelp` text on UserStorage, SharedStorage, ContextMembers and
// WorkspaceManager, all of which spell out "64 hex characters" and why rc.27
// makes the encoding no longer distinguishing. The application-id inputs were
// the ones that did not, and they are the ones that produced the report.

/** 32 bytes, hex. Case-insensitive — the node accepts either. */
export const HEX_ID = /^[0-9a-fA-F]{64}$/;

/** Ellipsis characters used by this app's own truncated id displays. */
const ELIDED = /[…]|\.\.\./;

/**
 * A short, safe rendering of a bad value for an error message.
 *
 * Elided in the middle rather than the end, because both easy mistakes are only
 * visible at one end or the other: a pasted-from-the-screen value ends in `…`,
 * and a base58 id has mixed case throughout.
 */
function preview(value: string): string {
  if (value.length <= 24) return value;
  return `${value.slice(0, 10)}…${value.slice(-10)}`;
}

/**
 * Return `value` trimmed if it is a 64-hex id, or throw saying exactly why not.
 *
 * `label` is the field name as the API spells it (`applicationId`), so the
 * message lines up with the node's own if one ever does get through.
 */
export function requireHexId(label: string, value: string): string {
  const v = value.trim();

  if (!v) {
    return fail(label, v, "it is empty");
  }
  if (HEX_ID.test(v)) return v;

  // The two mistakes worth naming, because the fix differs and neither is
  // guessable from "expected 64 hex characters".
  if (ELIDED.test(v)) {
    return fail(
      label,
      v,
      "it contains an ellipsis, so it looks like an id copied from a shortened " +
        "on-screen display. Copy the full value — the tables in this app " +
        "truncate ids for width and keep the whole value in the cell's tooltip",
    );
  }
  if (/^[1-9A-HJ-NP-Za-km-z]{32,50}$/.test(v)) {
    return fail(
      label,
      v,
      "it looks like a base58 id. core 0.11.0-rc.27 removed base58 — every id " +
        "is 64 hex characters now, so this value is from an older node or an " +
        "older note. Re-read it with `meroctl app ls`",
    );
  }
  if (/^[0-9a-fA-F]+$/.test(v)) {
    return fail(
      label,
      v,
      `it is hex but ${v.length} characters long, not 64 (32 bytes)`,
    );
  }
  return fail(
    label,
    v,
    `it is ${v.length} characters and contains something that is not hex`,
  );
}

function fail(label: string, value: string, why: string): never {
  throw new Error(
    `${label} must be 64 hex characters (32 bytes), but ${why}` +
      (value ? `: "${preview(value)}"` : "") +
      ". Get the application id from `meroctl app ls`, from the output of " +
      "`meroctl app install`, or by setting VITE_APP_ID.",
  );
}

/** Non-throwing form, for disabling a button or colouring an input. */
export function isHexId(value: string): boolean {
  return HEX_ID.test(value.trim());
}
