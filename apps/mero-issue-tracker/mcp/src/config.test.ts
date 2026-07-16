import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from './config.ts';

test('loadConfig defaults nodeUrl and strips trailing slash', () => {
  const cfg = loadConfig({ TRACKER_CONTEXT: 'my-tracker' });
  assert.equal(cfg.nodeUrl, 'http://localhost:2428');
  assert.equal(cfg.contextRaw, 'my-tracker');
  assert.equal(cfg.authToken, undefined);
  assert.equal(cfg.executorOverride, undefined);
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

test('loadConfig throws when TRACKER_CONTEXT is missing', () => {
  assert.throws(() => loadConfig({}), /TRACKER_CONTEXT/);
});

test('loadConfig throws when TRACKER_CONTEXT is blank', () => {
  assert.throws(() => loadConfig({ TRACKER_CONTEXT: '   ' }), /TRACKER_CONTEXT/);
});
