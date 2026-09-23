/**
 * Does the file this node handed us match the hash the agreement recorded?
 *
 * `DocumentInfo.hash` has always been written — on upload, and again on every
 * signature — and displayed in the audit trail. Nothing ever recomputed it. So
 * a blob that came back corrupted, truncated, or simply belonging to a
 * different document rendered happily, and the hash beside it on screen was
 * decoration rather than evidence.
 *
 * ⚠️ A mismatch WARNS rather than refusing to open, deliberately. The hash is
 * a plain SHA-256 over the uploaded bytes and should always match, but
 * documents written by older builds are live data this code has never verified
 * — turning that into a hard block would risk making existing agreements
 * unopenable to fix a problem we have not yet observed. Telling the reader
 * loudly is the honest half; tighten to a refusal once the fleet is known
 * clean.
 */
export type IntegrityResult =
  | { checked: true; ok: true }
  | { checked: true; ok: false; expected: string; actual: string }
  | { checked: false; reason: 'no-hash-recorded' };

export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function verifyDocumentBytes(
  bytes: ArrayBuffer,
  recordedHash: string | undefined | null,
): Promise<IntegrityResult> {
  // A document with no hash on record is not a failure — it is a document
  // this app cannot say anything about, and saying so is different from
  // claiming it is fine.
  const expected = (recordedHash ?? '').trim().toLowerCase();
  if (!expected) return { checked: false, reason: 'no-hash-recorded' };

  const actual = await sha256Hex(bytes);
  return actual === expected
    ? { checked: true, ok: true }
    : { checked: true, ok: false, expected, actual };
}

/** The sentence shown to the reader when the bytes do not match. */
export function integrityWarning(result: IntegrityResult): string | null {
  if (result.checked && !result.ok) {
    return (
      'The bytes this node returned do not match the hash recorded for this ' +
      `document (recorded ${result.expected.slice(0, 12)}…, got ` +
      `${result.actual.slice(0, 12)}…). Do not rely on what is shown below ` +
      'without checking with the other parties.'
    );
  }
  return null;
}
