// The shareable form of an invite, built by the platform SDK.
//
// Kept OUT of inviteCodec.ts on purpose: the Playwright specs import the codec
// for fixtures and run under Node's raw ESM loader, which rejects the SDK's
// extensionless directory imports. Only bundled code (and vitest, which inlines
// the SDK) reaches this module.

import { createLink } from "@calimero-network/mero-platform";

/**
 * The app's deep-link slug. The desktop resolves a link by
 * `Application.package`, and links.calimero.network resolves the web build by
 * asking the registry for that same package — so the slug IS the package id.
 * Keep equal to `slug`/`package` in `logic/Cargo.toml`.
 */
export const APP_SLUG = "com.calimero.meroblocks";

/**
 * The shareable form of an invite code: a canonical HTTPS link that opens the
 * desktop app where it is installed and the published web build otherwise.
 * `decodeInvite` reads a pasted link back, so the raw code still works.
 */
export function inviteLink(code: string): string {
  return createLink(APP_SLUG, "join", { invitation: code });
}

