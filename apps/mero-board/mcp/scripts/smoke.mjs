#!/usr/bin/env node
// End-to-end smoke test for the issue-tracker MCP server against a live node.
//
// Spawns the stdio server (src/index.ts) as a subprocess, speaks the MCP
// JSON-RPC-over-stdio protocol to it (initialize -> tools/list -> tools/call),
// and exercises the full round-trip: create_issue with all four sections ->
// list_issues -> get_issue (verify the sections survive) -> add_comment ->
// get_fix_prompt (verify the template is filled with the issue's content).
//
// Requires a running node with the tracker context provisioned. Configure via
// the same env vars the server reads:
//   CALIMERO_NODE_URL   base URL of the node (default http://localhost:2428)
//   TRACKER_CONTEXT     context id or alias  (required)
//   CALIMERO_AUTH_TOKEN bearer token         (if the node enforces auth)
//   TRACKER_EXECUTOR    executor public key  (else the node's first owned id)
//
// Usage: node mcp/scripts/smoke.mjs

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MCP_DIR = path.resolve(__dirname, '..');

if (!process.env.TRACKER_CONTEXT) {
  console.error('TRACKER_CONTEXT is required (context id or alias).');
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
  for (const t of ['create_issue', 'list_issues', 'get_issue', 'add_comment', 'assign_issue', 'get_fix_prompt', 'list_repos']) {
    assert(names.includes(t), `tool ${t} missing from tools/list`);
  }

  const stamp = Date.now().toString(36);
  const fields = {
    title: `Smoke issue ${stamp}`,
    summary: `summary-${stamp}`,
    impact: `impact-${stamp}`,
    repro: `repro-${stamp}`,
    resolution_criteria: `resolution-${stamp}`,
    priority: 'high',
    labels: ['bug', 'smoke'],
  };

  const created = await callTool('create_issue', fields);
  const id = created.id;
  assert(typeof id === 'string' && id.length > 0, `create_issue returned no id: ${JSON.stringify(created)}`);
  console.log('create_issue ->', id);

  const list = await callTool('list_issues', {});
  assert(Array.isArray(list) && list.some((i) => i.id === id), 'new issue not in list_issues');
  console.log(`list_issues -> ${list.length} issue(s), new one present`);

  const detail = await callTool('get_issue', { id });
  const issue = detail.issue;
  for (const f of ['summary', 'impact', 'repro', 'resolution_criteria']) {
    assert(issue[f] === fields[f], `section ${f} did not round-trip: got ${JSON.stringify(issue[f])}`);
  }
  assert(issue.title === fields.title, 'title did not round-trip');
  console.log('get_issue -> four sections round-tripped intact');

  const comment = await callTool('add_comment', { issue_id: id, body: `smoke comment ${stamp}` });
  assert(comment.id, `add_comment returned no id: ${JSON.stringify(comment)}`);
  console.log('add_comment ->', comment.id);

  const prompt = await callTool('get_fix_prompt', { id });
  assert(typeof prompt === 'string', 'get_fix_prompt did not return text');
  for (const [label, val] of [['title', fields.title], ['summary', fields.summary], ['impact', fields.impact], ['repro', fields.repro], ['resolution', fields.resolution_criteria]]) {
    assert(prompt.includes(val), `fix prompt missing ${label} content (${val})`);
  }
  assert(prompt.includes(id), 'fix prompt missing the issue id');
  console.log('get_fix_prompt -> template filled with issue content');

  console.log('\nMCP smoke PASSED');
}

main()
  .then(() => { server.kill(); process.exit(0); })
  .catch((err) => { console.error('\nMCP smoke FAILED:', err.message); server.kill(); process.exit(1); });
