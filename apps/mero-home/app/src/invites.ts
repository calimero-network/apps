import { createInviteStore, type InviteStore } from "@calimero-apps/connect";

import { APP } from "./session";

/**
 * Home's pending invite: captured in `main.tsx` before React mounts, held
 * across the passkey sign-up and dropped on sign-out by the passkey session.
 * An invite minted in Home lands in Home, which then shows the apps it gave.
 */
export const invites: InviteStore = createInviteStore(APP);

/**
 * Where a minted link opens: this page's own path, the served `/{version}/`
 * (as kv-store does until every cluster keeps the query on its root redirect).
 */
export const inviteRoot = (): string => window.location.pathname;
