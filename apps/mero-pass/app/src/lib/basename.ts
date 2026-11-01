/**
 * The app's base path: `/` on the dev server and a static host, the node's
 * `/{version}/` where the cluster serves the bundle's frontend (the build is
 * relative, `base: './'`). Ends with `/`.
 */
export function basename(pathname: string = window.location.pathname): string {
  const match = /^\/\d+\.\d+\.\d+[^/]*\//.exec(pathname);
  return match ? match[0] : '/';
}
