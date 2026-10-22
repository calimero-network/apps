import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from './config.ts';

test('loadConfig defaults nodeUrl and strips trailing slash', () => {
  const cfg = loadConfig({ BOARD_CONTEXT: 'my-board' });
  assert.equal(cfg.nodeUrl, 'http://localhost:2428');
  assert.equal(cfg.contextRaw, 'my-board');
  assert.equal(cfg.authToken, undefined);
  assert.equal(cfg.serviceName, 'board');
});

test('loadConfig reads BOARD_SERVICE, defaulting to "board"', () => {
  assert.equal(loadConfig({ BOARD_CONTEXT: 'ctx' }).serviceName, 'board');
  assert.equal(
    loadConfig({ BOARD_CONTEXT: 'ctx', BOARD_SERVICE: 'custom-service' }).serviceName,
    'custom-service',
  );
});

test('loadConfig reads all env vars and trims a trailing slash off the node URL', () => {
  const cfg = loadConfig({
    CALIMERO_NODE_URL: 'http://node.example:9999/',
    BOARD_CONTEXT: 'ctx-abc',
    CALIMERO_AUTH_TOKEN: 'secret-token',
  });
  assert.equal(cfg.nodeUrl, 'http://node.example:9999');
  assert.equal(cfg.contextRaw, 'ctx-abc');
  assert.equal(cfg.authToken, 'secret-token');
});

test('loadConfig throws when neither BOARD_CONTEXT nor BOARD_NAMESPACE is set', () => {
  assert.throws(() => loadConfig({}), /BOARD_NAMESPACE|BOARD_CONTEXT/);
});

test('loadConfig throws when BOARD_CONTEXT is blank and BOARD_NAMESPACE is unset', () => {
  assert.throws(() => loadConfig({ BOARD_CONTEXT: '   ' }), /BOARD_NAMESPACE|BOARD_CONTEXT/);
});

test('loadConfig accepts BOARD_NAMESPACE alone (no BOARD_CONTEXT)', () => {
  const cfg = loadConfig({ BOARD_NAMESPACE: 'my-team' });
  assert.equal(cfg.namespaceRaw, 'my-team');
  assert.equal(cfg.contextRaw, undefined);
  assert.equal(cfg.folderDefault, undefined);
});

test('loadConfig reads BOARD_FOLDER as the default folder', () => {
  const cfg = loadConfig({ BOARD_NAMESPACE: 'my-team', BOARD_FOLDER: 'frontend' });
  assert.equal(cfg.folderDefault, 'frontend');
});

test('loadConfig allows both BOARD_CONTEXT and BOARD_NAMESPACE to be set', () => {
  const cfg = loadConfig({ BOARD_CONTEXT: 'ctx-abc', BOARD_NAMESPACE: 'my-team' });
  assert.equal(cfg.contextRaw, 'ctx-abc');
  assert.equal(cfg.namespaceRaw, 'my-team');
});
