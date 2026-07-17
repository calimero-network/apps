import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from './config.ts';

test('loadConfig defaults nodeUrl and strips trailing slash', () => {
  const cfg = loadConfig({ TRACKER_CONTEXT: 'my-tracker' });
  assert.equal(cfg.nodeUrl, 'http://localhost:2428');
  assert.equal(cfg.contextRaw, 'my-tracker');
  assert.equal(cfg.authToken, undefined);
  assert.equal(cfg.executorOverride, undefined);
  assert.equal(cfg.serviceName, 'issue-tracker');
});

test('loadConfig reads TRACKER_SERVICE, defaulting to "issue-tracker"', () => {
  assert.equal(loadConfig({ TRACKER_CONTEXT: 'ctx' }).serviceName, 'issue-tracker');
  assert.equal(
    loadConfig({ TRACKER_CONTEXT: 'ctx', TRACKER_SERVICE: 'custom-service' }).serviceName,
    'custom-service',
  );
});

test('loadConfig reads all env vars and trims a trailing slash off the node URL', () => {
  const cfg = loadConfig({
    CALIMERO_NODE_URL: 'http://node.example:9999/',
    TRACKER_CONTEXT: 'ctx-abc',
    CALIMERO_AUTH_TOKEN: 'secret-token',
    TRACKER_EXECUTOR: 'executor-pubkey',
  });
  assert.equal(cfg.nodeUrl, 'http://node.example:9999');
  assert.equal(cfg.contextRaw, 'ctx-abc');
  assert.equal(cfg.authToken, 'secret-token');
  assert.equal(cfg.executorOverride, 'executor-pubkey');
});

test('loadConfig throws when neither TRACKER_CONTEXT nor TRACKER_NAMESPACE is set', () => {
  assert.throws(() => loadConfig({}), /TRACKER_NAMESPACE|TRACKER_CONTEXT/);
});

test('loadConfig throws when TRACKER_CONTEXT is blank and TRACKER_NAMESPACE is unset', () => {
  assert.throws(() => loadConfig({ TRACKER_CONTEXT: '   ' }), /TRACKER_NAMESPACE|TRACKER_CONTEXT/);
});

test('loadConfig accepts TRACKER_NAMESPACE alone (no TRACKER_CONTEXT)', () => {
  const cfg = loadConfig({ TRACKER_NAMESPACE: 'my-team' });
  assert.equal(cfg.namespaceRaw, 'my-team');
  assert.equal(cfg.contextRaw, undefined);
  assert.equal(cfg.repoDefault, undefined);
});

test('loadConfig reads TRACKER_REPO as the default repo', () => {
  const cfg = loadConfig({ TRACKER_NAMESPACE: 'my-team', TRACKER_REPO: 'frontend' });
  assert.equal(cfg.repoDefault, 'frontend');
});

test('loadConfig allows both TRACKER_CONTEXT and TRACKER_NAMESPACE to be set', () => {
  const cfg = loadConfig({ TRACKER_CONTEXT: 'ctx-abc', TRACKER_NAMESPACE: 'my-team' });
  assert.equal(cfg.contextRaw, 'ctx-abc');
  assert.equal(cfg.namespaceRaw, 'my-team');
});
