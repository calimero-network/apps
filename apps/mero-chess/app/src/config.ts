/**
 * The two values the provider needs, resolved once.
 *
 * Both default to the PUBLISHED values so a plain `vite build` — Vercel's
 * included — needs no environment at all, and an env var is only for pointing a
 * local build at a staging registry.
 */

/**
 * The bundle's package id. It is also the deep-link slug and the key the auth
 * frontend resolves this app's allowed callback origin by, so it must equal
 * `[package.metadata.calimero].package` in logic/Cargo.toml.
 */
export const PACKAGE_NAME =
  import.meta.env.VITE_PACKAGE_NAME?.trim() || "com.calimero.mero-chess";

/**
 * ⚠️ Passed alongside `packageName`, not instead of it.
 *
 * mero-js sends `package-name` whenever it is set and `registry-url` only if
 * given, and mero-react has NO default registry — it forwards whatever the app
 * passed. An app that sends a package name with no registry reaches the auth
 * frontend with nothing to resolve it against.
 */
export const REGISTRY_URL =
  import.meta.env.VITE_REGISTRY_URL?.trim() || "https://apps.calimero.network";
