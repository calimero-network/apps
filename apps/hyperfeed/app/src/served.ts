/**
 * Whether this page is the frontend the cluster serves from Hyperfeed's
 * bundle: `{label}.{apps_domain}/{version}/…`, the label 52 lowercase base32
 * characters (core's `app_host.rs`). That is where the production frontend
 * runs, and its CSP lets it connect to the cluster's API origins only and
 * frame nothing but itself: other apps open in a tab, and GitHub is not
 * fetched from there.
 */
const SERVED_HOST = /^[a-z2-7]{52}\./;

export const isServedByNode = (url: URL): boolean => SERVED_HOST.test(url.hostname);

/** The router's basename: `/{version}/` on a served page, `/` anywhere else. */
export const nodeBasename = (url: URL = new URL(window.location.href)): string =>
  isServedByNode(url) ? `/${url.pathname.split("/")[1]}/` : "/";
