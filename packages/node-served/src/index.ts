const LABEL = "[a-z2-7]{52}"; // lowercase unpadded base32 of the 32-byte app id
const NODE_APP_HOST = new RegExp(`^${LABEL}\\.`); // {label}.{base_domain}, the node's own app host
const DESKTOP_SCHEME_HOST = new RegExp(`^${LABEL}$`); // calimero-app://{label} on macOS
const DESKTOP_HTTP_HOST = new RegExp(`^calimero-app\\.${LABEL}$`); // http://calimero-app.{label} on Windows and Linux

export const isServedByNode = (url: URL): boolean =>
  url.protocol === "calimero-app:"
    ? DESKTOP_SCHEME_HOST.test(url.hostname)
    : NODE_APP_HOST.test(url.hostname) || DESKTOP_HTTP_HOST.test(url.hostname);

// A node serves an installed app from /{version}/, so routes and assets live under that prefix.
export const nodeBasename = (url: URL, devBase: string): string =>
  isServedByNode(url) ? `/${url.pathname.split("/")[1]}/` : devBase;
