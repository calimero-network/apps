// Reads the integration env that ci (and `pnpm e2e:up`) writes to
// app/.env.integration. Specs use envAvailable() to skip gracefully
// when the file is absent — i.e. when running outside a live-merod
// session.

export interface IntegrationEnv {
  applicationId: string;
  node1: NodeEnv;
  node2: NodeEnv | null;
}

export interface NodeEnv {
  url: string;
  accessToken: string;
  refreshToken: string;
}

const NODE1_KEYS = [
  'E2E_APPLICATION_ID',
  'E2E_NODE_URL',
  'E2E_ACCESS_TOKEN',
  'E2E_REFRESH_TOKEN',
] as const;

const NODE2_KEYS = [
  'E2E_NODE_URL_2',
  'E2E_ACCESS_TOKEN_2',
  'E2E_REFRESH_TOKEN_2',
] as const;

export interface AvailableOpts {
  twoNode?: boolean;
}

export function envAvailable(opts: AvailableOpts = {}): boolean {
  const node1 = NODE1_KEYS.every((k) => Boolean(process.env[k]));
  if (!opts.twoNode) return node1;
  return node1 && NODE2_KEYS.every((k) => Boolean(process.env[k]));
}

export function getEnv(opts: AvailableOpts = {}): IntegrationEnv {
  for (const k of NODE1_KEYS) {
    if (!process.env[k]) throw new Error(`Missing integration env var: ${k}`);
  }
  const node2 = opts.twoNode
    ? (() => {
        for (const k of NODE2_KEYS) {
          if (!process.env[k]) {
            throw new Error(`Missing two-node integration env var: ${k}`);
          }
        }
        return {
          url: process.env.E2E_NODE_URL_2!,
          accessToken: process.env.E2E_ACCESS_TOKEN_2!,
          refreshToken: process.env.E2E_REFRESH_TOKEN_2!,
        };
      })()
    : null;
  return {
    applicationId: process.env.E2E_APPLICATION_ID!,
    node1: {
      url: process.env.E2E_NODE_URL!,
      accessToken: process.env.E2E_ACCESS_TOKEN!,
      refreshToken: process.env.E2E_REFRESH_TOKEN!,
    },
    node2,
  };
}
