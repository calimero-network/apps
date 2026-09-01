// Tear down the local merobox stack started by e2e-up.ts.

import { spawnSync } from 'node:child_process';

console.log('Stopping merobox-managed nodes…');
spawnSync('merobox', ['stop', '--all'], { stdio: 'inherit' });
spawnSync('merobox', ['nuke', '--force'], { stdio: 'inherit' });
console.log('Done.');
