import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PACKAGE, LOCAL_NODES, loadConfig } from './config.ts';

const BASE = { TRACKER_WORKSPACE: 'Platform', CALIMERO_API_KEY: 'key' };

test('loadConfig defaults to the three merod local nodes and the package', () => {
  const cfg = loadConfig(BASE);
  assert.deepEqual(cfg.target, { kind: 'local', nodes: LOCAL_NODES });
  assert.equal(cfg.workspaceRaw, 'Platform');
  assert.equal(cfg.apiKey, 'key');
  assert.deepEqual(cfg.source, { package: DEFAULT_PACKAGE });
  assert.equal(cfg.appRaw, undefined);
});

test('loadConfig reads local nodes, a dev bundle, a default repo and an app pin', () => {
  const cfg = loadConfig({
    ...BASE,
    CALIMERO_NODES: 'http://127.0.0.1:2601/, http://127.0.0.1:2602',
    TRACKER_BUNDLE: 'bundle-hash',
    TRACKER_REPO: 'web',
    TRACKER_APP: 'app-1',
  });
  assert.deepEqual(cfg.target, { kind: 'local', nodes: ['http://127.0.0.1:2601', 'http://127.0.0.1:2602'] });
  assert.equal(cfg.source, 'bundle-hash');
  assert.equal(cfg.repoDefault, 'web');
  assert.equal(cfg.appRaw, 'app-1');
});

test('loadConfig connects to a cloud cluster by name, with a release floor', () => {
  const cfg = loadConfig({
    ...BASE,
    CALIMERO_TARGET: 'cloud',
    CALIMERO_CLUSTER: 'eu-shared-1',
    CALIMERO_MIN_RELEASE: '2.3.109',
    CALIMERO_ZONE: 'europe-west4-a',
  });
  assert.deepEqual(cfg.target, {
    kind: 'cloud',
    cluster: 'eu-shared-1',
    minReleaseVersion: '2.3.109',
    zone: 'europe-west4-a',
  });
  assert.throws(() => loadConfig({ ...BASE, CALIMERO_TARGET: 'cloud', CALIMERO_MIN_RELEASE: '1' }), /CALIMERO_CLUSTER/);
  assert.throws(() => loadConfig({ ...BASE, CALIMERO_TARGET: 'cloud', CALIMERO_CLUSTER: 'c' }), /CALIMERO_MIN_RELEASE/);
});

test('loadConfig refuses a missing workspace, API key, or an unknown target', () => {
  assert.throws(() => loadConfig({ CALIMERO_API_KEY: 'key' }), /TRACKER_WORKSPACE/);
  assert.throws(() => loadConfig({ TRACKER_WORKSPACE: 'w' }), /CALIMERO_API_KEY/);
  assert.throws(() => loadConfig({ ...BASE, CALIMERO_TARGET: 'relay' }), /"local", "cloud" or "node"/);
  assert.throws(() => loadConfig({ ...BASE, CALIMERO_NODES: 'ftp://x' }), /not an http/);
});

test('loadConfig reaches an attested node by URL, with a release floor', () => {
  const cfg = loadConfig({
    ...BASE,
    CALIMERO_TARGET: 'node',
    CALIMERO_NODES: 'https://node.example/',
    CALIMERO_MIN_RELEASE: '2.3.109',
  });
  assert.deepEqual(cfg.target, { kind: 'node', nodes: ['https://node.example'], minReleaseVersion: '2.3.109' });
  assert.throws(() => loadConfig({ ...BASE, CALIMERO_TARGET: 'node', CALIMERO_MIN_RELEASE: '1' }), /CALIMERO_NODES/);
  assert.throws(() => loadConfig({ ...BASE, CALIMERO_TARGET: 'node', CALIMERO_NODES: 'https://n' }), /CALIMERO_MIN_RELEASE/);
});
