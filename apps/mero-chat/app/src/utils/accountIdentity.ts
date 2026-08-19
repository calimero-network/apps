import axios from "axios";
import bs58 from "bs58";
import { getNodeUrl } from "@calimero-network/mero-react";

import { getAuthConfig } from "../api/meroJsClient";
import { log } from "./logger";
import { registerAccountIdentity } from "./selfIdentity";

const DEFAULT_ENDPOINT = "http://localhost:2428";

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
