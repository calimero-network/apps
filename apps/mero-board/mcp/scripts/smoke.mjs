#!/usr/bin/env node
// End-to-end smoke test for the mero-board MCP server against a live node.
//
// Spawns the stdio server (src/index.ts) as a subprocess, speaks the MCP
// JSON-RPC-over-stdio protocol to it (initialize -> tools/list -> tools/call),
// checks the board tools are registered, then calls list_folders and
// list_boards. Read-only: it creates nothing.
//
// Requires a running node with a mero-board namespace. Configure via the same
// env vars the server reads:
//   CALIMERO_NODE_URL   base URL of the node (default http://localhost:2428)
//   BOARD_NAMESPACE     namespace id or name (required unless BOARD_CONTEXT)
//   BOARD_FOLDER        folder (context alias) for list_boards, if the namespace has several
//   BOARD_CONTEXT       context id or alias  (direct pin, instead of BOARD_NAMESPACE)
//   CALIMERO_AUTH_TOKEN bearer token         (if the node enforces auth)
//   BOARD_EXECUTOR      executor public key  (else the node's first owned id)
//
// Usage: node mcp/scripts/smoke.mjs

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MCP_DIR = path.resolve(__dirname, '..');

if (!process.env.BOARD_NAMESPACE && !process.env.BOARD_CONTEXT) {
  console.error('BOARD_NAMESPACE (or BOARD_CONTEXT) is required.');
  process.exit(2);
}

// Speak MCP stdio framing: newline-delimited JSON-RPC messages.
const server = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
  cwd: MCP_DIR,
  stdio: ['pipe', 'pipe', 'inherit'],
  env: process.env,
});

let buf = '';
const pending = new Map();
server.stdout.on('data', (chunk) => {
  buf += chunk.toString();
  let nl;
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    if (msg.id != null && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
    }
  }
});

let nextId = 1;
function rpc(method, params) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    server.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    setTimeout(() => {
      if (pending.has(id)) { pending.delete(id); reject(new Error(`timeout: ${method}`)); }
    }, 30_000);
  });
}

// tools/call returns { content: [{ type:'text', text }] }; unwrap the text and
// parse JSON when the tool returned a structured value.
async function callTool(name, args) {
  const res = await rpc('tools/call', { name, arguments: args });
  const text = res?.content?.map((c) => c.text).join('') ?? '';
  if (res?.isError) throw new Error(`${name} failed: ${text}`);
  try { return JSON.parse(text); } catch { return text; }
}

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERT: ${msg}`);
}

async function main() {
  await rpc('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'smoke', version: '0' },
  });
  server.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');

  const tools = await rpc('tools/list', {});
  const names = tools.tools.map((t) => t.name).sort();
  console.log('tools/list:', names.join(', '));
  for (const t of ['list_folders', 'add_folder', 'list_boards', 'get_board', 'create_card', 'move_card', 'set_card']) {
    assert(names.includes(t), `tool ${t} missing from tools/list`);
  }

  if (process.env.BOARD_NAMESPACE) {
    const folders = await callTool('list_folders', {});
    assert(Array.isArray(folders), `list_folders did not return an array: ${JSON.stringify(folders)}`);
    console.log(`list_folders -> ${folders.length} folder(s): ${folders.map((f) => f.name).join(', ') || '(none)'}`);
  } else {
    console.log('list_folders skipped (BOARD_CONTEXT pin has no namespace)');
  }

  const boards = await callTool('list_boards', { include_archived: true });
  assert(Array.isArray(boards), `list_boards did not return an array: ${JSON.stringify(boards)}`);
  console.log(`list_boards -> ${boards.length} board(s)`);

  console.log('\nMCP smoke PASSED');
}

main()
  .then(() => { server.kill(); process.exit(0); })
  .catch((err) => { console.error('\nMCP smoke FAILED:', err.message); server.kill(); process.exit(1); });
