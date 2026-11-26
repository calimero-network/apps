/// <reference path="./importMeta.d.ts" />
/**
 * Which Calimero Cloud a build belongs to, and the public addresses that go
 * with it: the console a person deploys and opens apps from, the apps domain
 * its clusters serve frontends under, and the App Registry it publishes to.
 *
 * Decided from the build alone (`VITE_CALIMERO_ENV`, `production` when unset),
 * never from anything a server answers: a staging build links to staging and a
 * production build to production, whatever a node or the directory says.
 *
 * mero-js's `CLOUD_ENVIRONMENTS` holds each Cloud's node directory and trust;
 * these are the human-facing addresses beside them, keyed by the same
 * {@link CloudEnvironment}.
 */
import { CLOUD_ENVIRONMENTS, type CloudEnvironment } from "@calimero-network/mero-js";

/** The public addresses of one Calimero Cloud. */
export interface CloudLinks {
  /** The console: where a person deploys and opens an app. */
  console: string;
  /** Where a person deploys an app of their own. */
  deploy: string;
  /** The apps domain every cluster of this Cloud serves frontends under (`{label}.{appsDomain}`). */
  appsDomain: string;
  /** The App Registry this Cloud's apps are published to. */
  registry: string;
}

const PRODUCTION: Readonly<CloudLinks> = {
  console: "https://cloud.calimero.network",
  deploy: "https://cloud.calimero.network/deploy",
  appsDomain: CLOUD_ENVIRONMENTS.production.appsDomain,
  registry: "https://apps.calimero.network",
};

const STAGING: Readonly<CloudLinks> = {
  console: "https://staging.cloud.calimero.network",
  deploy: "https://staging.cloud.calimero.network/deploy",
  appsDomain: CLOUD_ENVIRONMENTS.staging.appsDomain,
  registry: "https://apps.staging.cloud.calimero.network",
};

/**
 * Every Calimero Cloud's public addresses, for code that names its Cloud
 * itself (a smoke test against production). An app's frontend uses
 * {@link cloudLinks}, its build's own.
 */
export const CLOUD_LINKS: Readonly<Record<CloudEnvironment, Readonly<CloudLinks>>> = {
  production: PRODUCTION,
  staging: STAGING,
};

/**
 * The public addresses of the Calimero Cloud the build names
 * (`VITE_CALIMERO_ENV`): staging's for `staging`, production's otherwise.
 *
 * Read as the literal `import.meta.env.VITE_CALIMERO_ENV`, which Vite replaces
 * with the build's value: the comparison folds at build time, so a staging
 * build carries staging's addresses and not production's. For rendering links,
 * so it never throws: a build with another `VITE_CALIMERO_ENV` fails to connect
 * anyway (`resolveTarget` and `connectTarget` refuse it). Only for code a Vite
 * build (or Vitest) compiles: plain Node has no `import.meta.env`.
 */
export function cloudLinks(): Readonly<CloudLinks> {
  return import.meta.env.VITE_CALIMERO_ENV === "staging" ? STAGING : PRODUCTION;
}
