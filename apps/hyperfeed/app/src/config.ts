/**
 * The two values the provider needs. Both default to the published values, so
 * a plain `vite build` needs no environment.
 */

/** Must equal `[package.metadata.calimero].package` in logic/Cargo.toml. */
export const PACKAGE_NAME = import.meta.env.VITE_PACKAGE_NAME?.trim() || "com.calimero.hyperfeed";

/** Passed with `packageName`, never instead of it: mero-react has no default registry. */
export const REGISTRY_URL = import.meta.env.VITE_REGISTRY_URL?.trim() || "https://apps.calimero.network";
