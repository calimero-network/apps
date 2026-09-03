// ── Identity for the registry-based login ─────────────────────────────────────
//
// WHAT WAS HERE BEFORE, and why all three values had to go:
//
//   APPLICATION_ID   = '46M9ayEPkpgDBoDDUP8bHJEwqCN78PXcndTUTW9crGc9'
//   APPLICATION_PATH = 'https://calimero-only-peers-dev.s3.amazonaws.com/
//                       uploads/mero_sign_test_v1.wasm'
//   CONTEXT_ID       = 'B8jh5twBKBXGvL4Cve2NHiBbGPm9cQzmD2uE9xamu9ke'
//
// * An ApplicationId is assigned PER INSTALL, so a baked one is correct only on
//   the machine it was copied from, and core answers a request naming an unknown
//   application with an opaque 500 rather than a 404. All three were also
//   base58, which core 0.11.0-rc.27 stopped using.
// * `APPLICATION_PATH` pointed at a dev S3 bucket holding a wasm called
//   `mero_sign_test_v1.wasm` — not the bundle this repo builds and not the one
//   the registry publishes.
// * `CONTEXT_ID` had no consumers at all; a baked context is not something an
//   app can assume exists on someone else's node.
//
// The package name replaces all of it: the registry resolves the application per
// node, serves the real bundle, and — critically — is what the auth frontend
// needs in order to authorize this origin as a login callback destination. See
// the note on `<CalimeroProvider>` in main.tsx.

/**
 * Reverse-DNS package id, matching `[package.metadata.calimero].package` in
 * `logic/Cargo.toml`. Keep the two in step: the registry lookup, the deep-link
 * slug and the login callback check all key off this exact string.
 */
export const PACKAGE_NAME =
  import.meta.env.VITE_PACKAGE_NAME?.trim() || 'com.calimero.mero-sign';

/**
 * The registry to resolve that package against. Hardcoded rather than
 * env-only, deliberately: with it unset the client falls back to its own
 * default, and the fleet's default is not this one — every other app in this
 * repo passes `https://apps.calimero.network` explicitly.
 */
export const REGISTRY_URL =
  import.meta.env.VITE_REGISTRY_URL?.trim() || 'https://apps.calimero.network';
