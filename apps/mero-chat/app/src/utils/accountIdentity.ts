import axios from "axios";
import bs58 from "bs58";
import { getNodeUrl } from "@calimero-network/mero-react";

import { getAuthConfig } from "../api/meroJsClient";
import { log } from "./logger";
import { registerAccountIdentity } from "./selfIdentity";

const DEFAULT_ENDPOINT = "http://localhost:2428";

/**
 * This node's ACCOUNT, cached after the first `/admin-api/identity` read.
 *
 * Account vs device is the distinction the app kept getting wrong: an account
 * is one person across all their devices, a device key signs for one of them.
 * Core identifies members, roles, message senders and member metadata by
 * ACCOUNT; the device key is only ever an `executorPublicKey`. Anything
 * user-facing that keys off a device key breaks the moment the same person
 * signs in from a second device.
 *
 * Admin routes want the hex form, the contract emits base58 — keep both.
 */
let selfAccount: { hex: string; base58: string } | null = null;

/** This node's account id, hex — the form every admin route expects. */
export function getSelfAccountHex(): string {
  return selfAccount?.hex ?? "";
}

/** This node's account id, base58 — the form the contract stamps on `sender`. */
export function getSelfAccountBase58(): string {
  return selfAccount?.base58 ?? "";
}

/** Test seam. */
export function clearSelfAccount(): void {
  selfAccount = null;
}

/**
 * Fetch this node's ACCOUNT id for a namespace and register it as "self".
 *
 * Core master splits identity in two:
 *   - account id — one per person, shared by all their devices
 *   - device id  — the per-device key, which is what `contexts/{id}/identities`
 *                  and `memberPublicKey` return
 *
 * The contract stamps `sender = UserId::new(env::account_id())`, i.e. the
 * ACCOUNT id, while the app only ever knew device ids. Comparing the two could
 * never match, so every message — including the user's own — looked like it
 * came from someone else and was toasted.
 *
 * The admin API returns the account id hex-encoded; the contract emits it
 * base58 (`UserId<32, 44>`). Register both so a comparison against either
 * encoding succeeds.
 */
export async function loadSelfAccountIdentity(
  // Kept for call-site compatibility: identity is node-wide, not per-namespace,
  // so the value is no longer used to build the request.
  _namespaceId?: string,
): Promise<string | null> {

  const base = getNodeUrl() || DEFAULT_ENDPOINT;
  const cfg = getAuthConfig();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (cfg?.jwtToken) headers.Authorization = `Bearer ${cfg.jwtToken}`;

  try {
    // `/admin-api/namespaces/{id}/account` 404s on merod 0.11.0-rc.24 — the
    // per-namespace route is gone. Identity is node-wide and served here, which
    // is also what mero-js's own `getNamespaceIdentity` resolves to. Response
    // shape is unchanged (`data.accountId`, `data.deviceId`).
    const res = await axios.get(`${base}/admin-api/identity`, { headers });
    const accountHex: string = res.data?.data?.accountId ?? "";
    const deviceHex: string = res.data?.data?.deviceId ?? "";
    if (!accountHex) return null;

    const accountB58 = hexToBase58(accountHex);
    registerAccountIdentity(accountHex);
    registerAccountIdentity(accountB58);
    // deviceId is null on some nodes; register it only when present.
    if (deviceHex) {
      registerAccountIdentity(deviceHex);
      registerAccountIdentity(hexToBase58(deviceHex));
    }

    selfAccount = { hex: accountHex, base58: accountB58 };
    log.info("AccountIdentity", `self account ${accountB58} (${accountHex})`);
    return accountB58;
  } catch (error) {
    log.warn("AccountIdentity", "could not load account id", error);
    return null;
  }
}

/** Hex → base58, the encoding `UserId` uses on the wire. */
export function hexToBase58(hex: string): string {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (!clean || clean.length % 2 !== 0) return "";
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.substr(i * 2, 2), 16);
  }
  return bs58.encode(bytes);
}

/** base58 → hex, the encoding the admin routes require. */
export function base58ToHex(id: string): string {
  try {
    return Array.from(bs58.decode(id))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    return "";
  }
}

const HEX_ACCOUNT = /^[0-9a-f]{64}$/i;

/**
 * Canonical account-id conversions.
 *
 * These used to be re-exported from `@calimero-network/mero-js`, which owned
 * them from 13.2.0. mero-js 15 deleted `src/account` on the reasoning that core
 * removed base58 from every id (calimero-network/core#3691), so a bridge
 * between two spellings is no longer needed.
 *
 * That is true of ids a node produces TODAY. It is not true of the data already
 * in a context: every reaction, profile and mention written before rc.27 stamped
 * a BASE58 account into replicated CRDT state, and that state does not migrate
 * when a node upgrades. A client that can only speak hex silently stops matching
 * its own historical reactions — the exact failure the bridge exists to prevent,
 * reappearing against stored data instead of across an API boundary.
 *
 * So the conversions live here again, implemented on the same `hexToBase58` /
 * `base58ToHex` this module already had. Each returns its input unchanged when
 * it is not a 32-byte account, so a device key or an alias survives a call.
 */
export function toAccountHex(id: string | null | undefined): string {
  const trimmed = (id ?? "").trim();
  if (!trimmed) return "";
  if (HEX_ACCOUNT.test(trimmed)) return trimmed.toLowerCase();
  const hex = base58ToHex(trimmed);
  return hex.length === 64 ? hex : trimmed;
}

/** The form pre-rc.27 contract data stamped on `sender` and keyed profiles by. */
export function toAccountBase58(id: string | null | undefined): string {
  const trimmed = (id ?? "").trim();
  if (!trimmed) return "";
  if (!HEX_ACCOUNT.test(trimmed)) return trimmed;
  return hexToBase58(trimmed) || trimmed;
}

/**
 * True when both ids name the same account, whichever encoding each is in.
 *
 * Two ids that are not accounts compare false rather than accidentally matching
 * as raw strings.
 */
export function sameAccount(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const left = toAccountHex(a);
  const right = toAccountHex(b);
  return HEX_ACCOUNT.test(left) && left === right;
}


/**
 * A short, honest stand-in for an account with no name yet.
 *
 * Used where a display name is missing — a member whose metadata has not synced
 * yet, or one who has left the namespace. Showing a truncated account is
 * preferable to showing a name captured at some earlier moment: the account is
 * still true, whereas a stale name asserts something that may no longer be.
 */
export function shortAccount(account: string | undefined): string {
  const id = (account ?? "").trim();
  if (!id) return "unknown";
  return id.length >= 8 ? `${id.slice(0, 4)}…${id.slice(-4)}` : id;
}
