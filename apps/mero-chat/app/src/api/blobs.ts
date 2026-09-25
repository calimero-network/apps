// The blob contract, in one place.
//
// Attachments, inline images and avatars all travel as blobs, and every one of
// them crosses a node: the sender's node stores the bytes, the contract stores
// only a 32-byte id, and the receiver's node has to go and find them. What that
// takes changed twice, and both changes are silent — the call succeeds, and the
// picture never appears.
//
// ── rc.39: discovery is `?context_id=`, and nothing else ─────────────────────
//
// There used to be a blob DHT. A node that wanted a blob asked the network and
// somebody answered. rc.39 removed it. A read is now either
//
//   - LOCAL, when no context is given: the node looks in its own blob store and
//     404s if it is not there. Immediate, and useless for anything a peer
//     uploaded.
//   - DISCOVERY, when a context is given: the node probes THAT CONTEXT's peers
//     (availability nodes first) for a holder, then transfers the bytes.
//
// So `contextId` is not an optimisation and it is not optional. `getBlob`'s
// type marks it optional because a local read is a legitimate thing to want;
// for this app it never is. Every blob we read belongs to a conversation, and
// the conversation IS the context to probe.
//
// The write side is weaker than the SDK doc implies, and this is MEASURED
// against two real rc.41 nodes rather than read off the types.
//
// `uploadBlob`'s doc says "Without it the blob is only readable on this node."
// That is not what happens: a blob uploaded with NO context is still served to
// a second node that asks WITH one, because discovery probes the reader's
// context and any peer holding the bytes answers. See the matching case in
// `e2e/blobs.spec.ts`, which asserted the documented behaviour first and had to
// be corrected.
//
// What the announce actually buys is availability-node prefetch —
// `blob_announce_to_context` returns once the announce is SCHEDULED, and since
// rc.39 that path feeds prefetch only, never discovery. It matters when the
// holder is offline and an availability node has to answer instead.
//
// So `contextId` stays required on upload: it costs nothing, it is the
// documented contract, and prefetch is worth having. Just not for the reason
// the doc gives.
//
// ── The 35-second budget ─────────────────────────────────────────────────────
//
// Core bounds the discovery sweep by a ~30s deadline, and the byte transfer is
// on top of that. A client budget under 30s therefore aborts a fetch that was
// about to succeed, in exactly the case discovery exists for: a blob a peer
// holds and we do not.
//
// mero-js has no per-call timeout on `getBlob` — `BlobReadOptions` is
// `{ contextId }` and nothing else — so the budget is the MeroJs client's, which
// MeroProvider sets. It defaults to 30_000, i.e. precisely the deadline, so
// `main.tsx` passes `timeoutMs={BLOB_READ_TIMEOUT_MS}` instead. If that prop
// ever goes away, slow cross-node image loads come back and look like flake.
//
// ── Blob ids are hex ─────────────────────────────────────────────────────────
//
// Since core 0.11.0-rc.27 base58 is off the wire: a blob id is 32 bytes as 64
// hex characters. Re-encoding one to base58 before storing it gives a
// write-then-read failure that presents as three unrelated bugs (upload "works",
// the contract holds a string the node refuses, the reader sees a 404) — see
// `toBlobIdHex`.
import {
  getNodeUrl,
  type GetBlobInfoResponseData,
} from "@calimero-network/mero-react";
import bs58 from "bs58";
import { getMeroJs } from "./meroJsClient";

/**
 * Client budget for a blob read, in milliseconds.
 *
 * 35_000, not 30_000: core's discovery deadline IS 30s, so a 30s client budget
 * races it and loses roughly half the time. Not unbounded either — a stalled
 * node should fail, just not before core has finished looking.
 */
export const BLOB_READ_TIMEOUT_MS = 35_000;

/** 32 bytes as hex — what `GET /admin-api/blobs/:id` accepts. */
const HEX_32 = /^[0-9a-fA-F]{64}$/;

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Canonicalise whatever a blob id arrived as into the hex form the node takes.
 *
 * Returns `""` — never throws — for anything unusable, so callers branch on
 * `if (!blobId)` rather than wrapping every read in a try.
 *
 * Three input shapes are real here:
 *
 *   - hex, with or without `0x`: what the node returns and what the contract
 *     should hold. Passed through, lowercased.
 *   - a byte array: the ABI types a `BlobId` field as bytes, so a value read
 *     back through a generated client can arrive as `number[]`.
 *   - base58: ONLY for reading. Rows written before rc.27 hold base58, and
 *     refusing them would orphan every attachment sent before the cutover.
 *     Nothing in this app should ever produce one.
 */
export function toBlobIdHex(value: string | number[] | Uint8Array): string {
  if (Array.isArray(value) || value instanceof Uint8Array) {
    const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
    return bytes.length === 32 ? bytesToHex(bytes) : "";
  }
  if (typeof value !== "string") return "";

  const trimmed = value.trim();
  if (!trimmed) return "";
  const unprefixed = trimmed.startsWith("0x") ? trimmed.slice(2) : trimmed;
  if (HEX_32.test(unprefixed)) return unprefixed.toLowerCase();

  try {
    const bytes = bs58.decode(trimmed);
    return bytes.length === 32 ? bytesToHex(bytes) : "";
  } catch {
    return "";
  }
}

/** True when `value` names a blob this node could actually fetch. */
export function isUsableBlobId(value: string | number[] | Uint8Array): boolean {
  return toBlobIdHex(value).length === 64;
}

export class BlobContextRequiredError extends Error {
  constructor(operation: string) {
    super(
      `${operation} needs a context id. Since core 0.11.0-rc.39 a blob is found ` +
        `by probing a context's peers — a read without one never leaves this ` +
        `node's own store, and an upload without one is never prefetched by the ` +
        `context's availability nodes.`,
    );
    this.name = "BlobContextRequiredError";
  }
}

/**
 * An empty string is not "no context", it is a context id of zero length — and
 * mero-js tests `if (options.contextId)`, so `''` silently degrades to the
 * local-only mode rather than erroring. Catch it here, where the message can
 * say what went wrong.
 */
function requireContext(
  contextId: string | undefined,
  operation: string,
): string {
  const id = (contextId ?? "").trim();
  if (!id) throw new BlobContextRequiredError(operation);
  return id;
}

export interface BlobUploadResult {
  blobId: string;
  size: number;
}

/**
 * Store bytes on this node and announce them to `contextId`, so the
 * conversation's other members can find them.
 *
 * `contextId` is required. See the module header.
 */
export async function uploadBlob(
  data: Blob | ArrayBuffer | Uint8Array,
  contextId: string,
): Promise<BlobUploadResult> {
  const ctx = requireContext(contextId, "uploadBlob");

  // The body is streamed verbatim as `application/octet-stream`. NEVER wrap it
  // in FormData: `PUT /admin-api/blobs` does not parse multipart, so the
  // boundary and part headers would be stored as part of the blob. It
  // round-trips, and every downloaded byte is wrong.
  const res = await getMeroJs().admin.uploadBlob({ data, contextId: ctx });

  // mero-js 19 renames the wire's `blob_id` and unwraps the `data` envelope, so
  // this is flat camelCase. Older code here read `raw.blob_id ?? raw.blobId`
  // against a `getBlob` that returned metadata; both are gone.
  const blobId = toBlobIdHex(res?.blobId ?? "");
  if (!blobId) {
    throw new Error(
      `The node returned a blob id this app cannot use: ${String(res?.blobId)}`,
    );
  }
  return { blobId, size: res?.size ?? 0 };
}

/**
 * Fetch a blob's bytes, probing `contextId`'s peers when this node does not
 * hold them.
 *
 * Returns a `Blob`, not the raw `ArrayBuffer`: every call site here hands the
 * result to `URL.createObjectURL` or `FileReader`, and an ArrayBuffer
 * type-checks in some of those positions while rendering as `[object Object]`.
 *
 * Throws on a miss. The node answers 404 both for "no such blob" and for "no
 * peer holds it", and they are not distinguishable from here.
 */
export async function downloadBlob(
  blobId: string,
  contextId: string,
): Promise<Blob> {
  const ctx = requireContext(contextId, "downloadBlob");
  const id = toBlobIdHex(blobId);
  if (!id) throw new Error(`Not a usable blob id: ${blobId}`);

  // mero-js owns the URL, the `context_id` query param and the Authorization
  // header. This used to be a hand-rolled `fetch` against
  // `/admin-api/blobs/:id`, written when `admin.getBlob` returned metadata
  // rather than bytes; mero-js 19 returns the bytes, so the hand-rolled copy is
  // now just a second place for the read and write sides to drift apart.
  const buffer = await getMeroJs().admin.getBlob(id, { contextId: ctx });
  return new Blob([buffer]);
}

/**
 * A blob's presence and size WITHOUT downloading it — a `HEAD`, not a `GET`.
 *
 * Worth asking before pulling something large, and the only way to tell a
 * genuine "no holder" from a transport failure: `found: false` is the node's
 * 404, anything else throws.
 *
 * `hash` and `mimeType` are absent when the answer came from a peer probe,
 * which carries presence and size only — `source` says which. Do not read a
 * missing `mimeType` as a malformed response.
 */
export async function blobInfo(
  blobId: string,
  contextId: string,
): Promise<{ found: boolean; info: GetBlobInfoResponseData | null }> {
  const ctx = requireContext(contextId, "blobInfo");
  const id = toBlobIdHex(blobId);
  if (!id) return { found: false, info: null };

  try {
    const info = await getMeroJs().admin.getBlobInfo(id, { contextId: ctx });
    return { found: true, info };
  } catch (e) {
    if (isNotFound(e)) return { found: false, info: null };
    throw e;
  }
}

/** Drop a blob from THIS node's store. Does not reach peers that hold a copy. */
export async function deleteBlob(blobId: string): Promise<void> {
  const id = toBlobIdHex(blobId);
  if (!id) return;
  await getMeroJs().admin.deleteBlob(id);
}

/** A 404 from a blob route, however the transport surfaced it. */
export function isNotFound(e: unknown): boolean {
  const status = (e as { status?: number })?.status;
  if (status === 404) return true;
  const message = e instanceof Error ? e.message : String(e ?? "");
  return /\b404\b|not found/i.test(message);
}

/**
 * The URL a blob would be read from. Not used to fetch — mero-js does that —
 * but tests assert on it, and an `<a download>` needs somewhere to point.
 *
 * Kept next to the calls it mirrors so the `context_id` spelling cannot drift:
 * the query param is snake_case on the wire even though the SDK option is
 * `contextId`.
 */
export function blobUrl(blobId: string, contextId: string): string {
  const base = getNodeUrl();
  if (!base) throw new Error("Node URL is not set.");
  const url = new URL(`/admin-api/blobs/${toBlobIdHex(blobId)}`, base);
  url.searchParams.set("context_id", contextId);
  return url.toString();
}
