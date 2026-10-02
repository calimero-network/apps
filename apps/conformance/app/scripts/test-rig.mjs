/**
 * `pnpm --filter conformance test:rig`: bring the rig up, run the matrix in
 * both modes, write the report, take the rig down — and exit non-zero on any
 * row whose outcome is not the one its mode expects.
 *
 * KEEP_RIG=1 leaves the rig running afterwards (stop it with `pnpm rig:down`);
 * SKIP_RIG_UP=1 runs against a rig that is already up.
 */
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const app = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const rig = resolve(app, '../rig');
const run = (cmd, args) => spawnSync(cmd, args, { cwd: app, stdio: 'inherit' }).status ?? 1;

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
