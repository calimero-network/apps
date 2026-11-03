/**
 * The app's identity and look. These used to come from `studio.config.json`,
 * v1 tooling's file (services, the registry version), which a component app
 * does not use: the package id is the contract crate's
 * `[package.metadata.calimero] package`, and a release's version is the
 * registry's.
 */

/** The package production instances are created from. */
export const APP_PACKAGE = 'com.calimero.mero-issue-tracker';
/** The app's name in stored keys (sessions, selections). */
export const APP_NAME = 'mero-issue-tracker';
/** Where the tracker lives inside the router. */
export const APP_ROUTE = '/issue-tracker';
export const PRODUCT_NAME = 'Mero Issue Tracker';
export const APP_DESCRIPTION =
  'A private, real-time issue board for a small engineering team - create, triage, and discuss issues together';
export const THEME = {
  primaryColor: '#2563EB',
  accentColor: '#F97316',
  style: 'clean-modern',
} as const;
