/**
 * Reverse-DNS package id, matching `[package.metadata.calimero].package` in
 * `logic/Cargo.toml`. Production instances are created from it
 * (`VITE_CALIMERO_PACKAGE` overrides it, see `@calimero-apps/connect`).
 */
export const PACKAGE_NAME = 'com.calimero.mero-sign';
