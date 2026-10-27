/**
 * @calimero-apps/cloud: the API the apps were written against (v1's
 * mero-react and mero-js names), running on release-v2's cloud client.
 *
 * Types are v1's, vendored in ../types so every app keeps compiling unchanged;
 * the runtime is ./backend.ts (the cluster) and ./react.js (hooks and UI).
 */
export * from './backend.ts';
export * from './react.js';
