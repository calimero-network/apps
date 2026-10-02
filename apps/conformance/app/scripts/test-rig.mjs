/**
 * `pnpm --filter conformance test:rig`: bring the rig up, run the matrix in
 * both modes, write the report, take the rig down — and exit non-zero on any
 * row whose outcome is not the one its mode expects.
 *
 * KEEP_RIG=1 leaves the rig running afterwards (stop it with `pnpm rig:down`);
 * SKIP_RIG_UP=1 runs against a rig that is already up.
 *
 * CONFORMANCE_TARGET=<file> runs against relays this script did not start — a
 * hosted fleet relay, say — instead of the local rig. The file names:
 *
 *   { "cloudUrl":      the cloud an account asks for routing (namespace admitters),
 *     "applicationId": scaffolding-e2e's application id on that relay,
 *     "namespaceId":   a namespace the relay admits accounts to,
 *     "invitation":    an invitation to it that names the relay as admitter,
 *     "ownerUrl"?, "ownerToken"?: { access_token, refresh_token } — a node to
 *                     drive the node run with; without them only the account
 *                     run runs }
 *
 * Nothing is started or stopped. Two fresh accounts are minted here, offline,
 * as the rig mints its own, and the account run joins the namespace with the
 * invitation, founds its own namespace through the relay, and runs the matrix.
 * Every write lands on the target: point it only at relays you mean to test.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const app = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const rig = resolve(app, '../rig');
const run = (cmd, args, env = process.env) => spawnSync(cmd, args, { cwd: app, stdio: 'inherit', env }).status ?? 1;

const target = process.env.CONFORMANCE_TARGET;
if (target) process.exit(runExternal(resolve(process.cwd(), target)));

if (!process.env.SKIP_RIG_UP) {
  if (run('sh', [resolve(rig, 'up.sh')]) !== 0) {
    console.error('test:rig: the rig did not come up; see apps/conformance/rig/.state/run/logs');
    run('sh', [resolve(rig, 'down.sh')]);
    process.exit(1);
  }
}

const status = run('pnpm', ['exec', 'playwright', 'test']);

if (!process.env.KEEP_RIG) run('sh', [resolve(rig, 'down.sh')]);
process.exit(status);

function runExternal(file) {
  let t;
  try {
    t = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    console.error(`test:rig: cannot read CONFORMANCE_TARGET ${file}: ${e.message}`);
    return 1;
  }
  const missing = ['cloudUrl', 'applicationId', 'namespaceId', 'invitation'].filter((k) => !t[k]);
  if (missing.length) {
    console.error(`test:rig: CONFORMANCE_TARGET ${file} is missing ${missing.join(', ')}`);
    return 1;
  }
  if (Boolean(t.ownerUrl) !== Boolean(t.ownerToken)) {
    console.error('test:rig: give ownerUrl and ownerToken together, or neither (account run only)');
    return 1;
  }
  const mint = () => {
    const out = spawnSync('node', [resolve(app, 'scripts/mint-account.mjs')], { cwd: app, encoding: 'utf8' });
    if (out.status !== 0) throw new Error(`minting an account failed: ${out.stderr}`);
    return JSON.parse(out.stdout.trim().split('\n').pop());
  };
  let accounts;
  try {
    accounts = { a: mint(), b: mint() };
  } catch (e) {
    console.error(`test:rig: ${e.message}`);
    return 1;
  }
  // The shape the spec reads from a rig's rig.json; the rig-only fields (the
  // relay's account, the v2 bundle, the ingress) stay empty: the steps that use
  // them run only in the node run, which needs an owner node.
  const rigJson = {
    ownerUrl: t.ownerUrl ?? '',
    ingressUrl: '',
    cloudUrl: t.cloudUrl,
    applicationId: t.applicationId,
    namespaceId: t.namespaceId,
    mpkV2: '',
    relayAccount: '',
    ownerToken: t.ownerToken ?? { access_token: '', refresh_token: '' },
    accounts,
    invitations: { a: t.invitation, b: null },
    external: true,
  };
  const dir = resolve(rig, '.state/external');
  mkdirSync(dir, { recursive: true });
  const rigFile = resolve(dir, 'rig.json');
  writeFileSync(rigFile, JSON.stringify(rigJson, null, 2));
  console.log(`test:rig: external target ${file}; accounts ${accounts.a.account.slice(0, 8)}… and ${accounts.b.account.slice(0, 8)}…; ${t.ownerUrl ? 'account and node runs' : 'account run only'}`);
  return run('pnpm', ['exec', 'playwright', 'test'], { ...process.env, CONFORMANCE_RIG: rigFile });
}
