/**
 * The app's identity and look. These used to come from `studio.config.json`,
 * v1 tooling's file (services, the registry version), which a component app
 * does not use: the package id is the contract crate's
 * `[package.metadata.calimero] package`, and a release's version is the
 * registry's.
 */

/** The package production instances are created from. */
export const APP_PACKAGE = 'com.calimero.mero-crm';
/** The app's name in stored keys (sessions, selections). */
export const APP_NAME = 'mero-crm';
/** Where the CRM lives inside the router. */
export const APP_ROUTE = '/crm';
export const PRODUCT_NAME = 'Mero CRM';
export const APP_DESCRIPTION =
  'A simple, private sales CRM — track your pipeline, work your deals, and never lose a follow-up';
export const THEME = {
  primaryColor: '#2563EB',
  accentColor: '#F97316',
  style: 'clean-modern',
} as const;
