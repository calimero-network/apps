import type { Routes } from "@calimero-network/mero-js";

/**
 * Some of a `CalimeroClient`'s generated methods, by group: what a function
 * that calls only those takes, so a test hands it a fake with just them.
 *
 *     ClientRoutes<{ orgs: "get" | "metadata"; auth: "me" }>
 *     // { orgs: Pick<client.orgs, "get" | "metadata">; auth: Pick<client.auth, "me"> }
 */
export type ClientRoutes<P extends { [G in keyof Routes]?: keyof Routes[G] }> = {
  readonly [G in keyof P & keyof Routes]: Pick<Routes[G], P[G] & keyof Routes[G]>;
};
