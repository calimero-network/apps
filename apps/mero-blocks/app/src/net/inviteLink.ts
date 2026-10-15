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
export const APP_SLUG = "com.calimero.mero-blocks";

/**
 * The shareable form of an invite code: a canonical HTTPS link that opens the
 * desktop app where it is installed and the published web build otherwise.
 * Opening it is the only way an invite gets in: the shared capture
 * (`primeInvitationCapture` in main.ts) reads the code back out.
 */
export function inviteLink(code: string): string {
  return createLink(APP_SLUG, "join", { invitation: code });
}

