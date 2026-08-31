// Does every call actually reach a method that exists?
//
// This exists because of a bug it would have caught on day one: the frontend
// shipped 13 `ws_*` methods — a whole Workspace Manager section, plus calls in
// Context Members and the Setup Wizard, plus 19 assertions in Run All Tests —
// against a contract that had never defined a single one of them. Nothing was
// red. The Playwright suite MOCKS the RPC layer, so it happily asserted against
// `ws_my_role: "admin"` fixtures, and no merobox workflow named a `ws_*` method
// either. Both test layers had a hole of exactly the same shape, and the only
// way to notice was to click the section against a live node.
//
// So the check is not "do the tests pass" but "do the two sides agree", in all
// three directions:
//
//   1. every method the FRONTEND calls exists in the ABI, with the right
//      argument names
//   2. every method a MEROBOX WORKFLOW calls exists in the ABI, likewise
//   3. every method the CONTRACT exports is called by at least one of them, or
//      is explicitly listed as unreachable from both
//
// (3) is the half that matters most for a scaffold: the whole point of this repo
// is that its contract surface is exercised, so a method nothing calls is either
// dead or a missing test, and either way someone should have to say which.
//
// The ABI is the source of truth, and CI regenerates it from the compiled wasm
// and fails if the committed copy has drifted — otherwise this would happily
// validate against a stale snapshot and report success. See the `Build WASM`
// job in .github/workflows/frontend-playwright.yml.
//
// Run it directly:  node scripts/check-contract-calls.mjs
// It also runs as part of `pnpm test`, which is what gates CI.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(HERE, "..", "..");

/** Methods no caller is expected to have, each with the reason why. */
export const UNCALLED_BY_DESIGN = {
  init: "the node calls it once at context creation; it is not on the RPC surface",
  ws_pong:
    "xcall-only. `#[app::xcall(from_same_app)]`, and the body rejects a call with no `env::xcall_origin()` — a frontend calling it directly is the case it exists to refuse",
  increment_counter: "legacy alias for increment_g_counter, kept for older clients",
  get_counter: "legacy alias for get_g_counter, kept for older clients",
};

// ── the ABI ───────────────────────────────────────────────────────────────────

/** `{ methodName: Set<paramName> }` from the committed ABI. */
export function readAbi(root = REPO_ROOT) {
  const abi = JSON.parse(readFileSync(join(root, "logic/res/abi.json"), "utf8"));
  const methods = new Map();
  for (const m of abi.methods ?? []) {
    methods.set(m.name, new Set((m.params ?? []).map((p) => p.name)));
  }
  return methods;
}

// ── the frontend ──────────────────────────────────────────────────────────────

/**
 * Every contract call in the frontend.
 *
 * All of them funnel through one helper — `call(...)` in `src/api/kvStore.ts`,
 * itself a wrapper over `rpcRaw` — so the call sites are a literal method name
 * followed by an object literal, and can be read statically. `rpcRaw`/`rpcCall`
 * are matched too, for anything that ever skips the wrapper.
 *
 * `args` is `null` when the argument is not an object literal (a variable, a
 * spread): the method name is still checked, the argument names are not.
 */
const CALL_SITE = /\b(?:call|rpcRaw|rpcCall)\s*(?:<[\s\S]*?>)?\s*\(\s*"([A-Za-z_]\w*)"/g;

export function collectFrontendCalls(root = REPO_ROOT) {
  const sites = [];
  for (const file of walk(join(root, "app/src"), /\.(ts|tsx)$/)) {
    // Test files assert against mocks, not against the contract. They are the
    // reason this checker exists, so they are not evidence of coverage.
    if (/\.(test|spec)\.tsx?$/.test(file)) continue;

    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(CALL_SITE)) {
      sites.push({
        method: m[1],
        args: objectLiteralKeys(src, m.index + m[0].length),
        where: `${relative(root, file)}:${lineOf(src, m.index)}`,
      });
    }
  }
  return sites;
}

/**
 * Top-level keys of the object literal that follows `from`, or null if the next
 * argument is not a literal we can read.
 *
 * Handles shorthand (`{ key, value }`) and renamed (`{ key: k }`) properties,
 * which is the whole difficulty: the frontend's bindings are written in the
 * shorthand form almost everywhere, so a naive `(\w+)\s*:` scan reports every
 * single call site as sending no arguments at all.
 */
function objectLiteralKeys(src, from) {
  const comma = src.indexOf(",", from);
  const close = src.indexOf(")", from);
  if (comma === -1 || (close !== -1 && close < comma)) return new Set(); // no second argument
  const open = src.indexOf("{", comma);
  if (open === -1 || (close !== -1 && close < open && !src.slice(comma, close).trim().startsWith("{"))) {
    // The argument exists but is not an object literal.
    const arg = src.slice(comma + 1, close === -1 ? comma + 2 : close).trim();
    return arg.startsWith("{") ? new Set() : null;
  }
  if (src.slice(comma + 1, open).trim() !== "") return null; // e.g. `, args` then a block

  const body = balanced(src, open);
  if (body === null) return null;
  if (/\.\.\./.test(body)) return null; // a spread: contents unknown statically

  const keys = new Set();
  let depth = 0;
  for (const tok of body.slice(1, -1).matchAll(/[{}[\]()]|(?:^|[,{[(\s])([A-Za-z_]\w*)\s*(:|,|$|\})/g)) {
    if (tok[1] !== undefined && depth === 0) keys.add(tok[1]);
    for (const ch of tok[0]) {
      if ("{[(".includes(ch)) depth++;
      else if ("}])".includes(ch)) depth--;
    }
  }
  return keys;
}

// ── the merobox workflows ─────────────────────────────────────────────────────

/**
 * Every contract call in `logic/workflows/*.yml`.
 *
 * Hand-parsed rather than via a YAML library so this file stays dependency-free
 * — these documents are machine-uniform lists of `- type: call` items, and a
 * misparse cannot hide: the committed workflows must produce zero findings, so
 * the parser is under test by every run.
 */
export function collectWorkflowCalls(root = REPO_ROOT) {
  const sites = [];
  const dir = join(root, "logic/workflows");
  for (const file of walk(dir, /\.ya?ml$/)) {
    const lines = readFileSync(file, "utf8").split("\n");

    for (const [i, line] of lines.entries()) {
      const item = /^(\s*)-\s/.exec(line);
      if (!item) continue;

      // A list item runs until the next item at the same-or-shallower indent.
      const indent = item[1].length;
      // Keys of the item sit at the indent of the text after `- `.
      const keyIndent = indent + 2;
      let end = lines.length;
      for (let j = i + 1; j < lines.length; j++) {
        const next = /^(\s*)-\s/.exec(lines[j]);
        if (next && next[1].length <= indent) { end = j; break; }
        if (/^\s*\S/.test(lines[j]) && indentOf(lines[j]) < keyIndent) { end = j; break; }
      }
      const block = lines.slice(i, end);

      const method = keyValue(block, keyIndent, "method");
      if (!method || keyValue(block, keyIndent, "type") !== "call") continue;

      sites.push({
        method,
        args: blockKeys(block, keyIndent, "args"),
        where: `${relative(root, file)}:${i + 1}`,
      });
    }
  }
  return sites;
}

function indentOf(line) {
  return /^(\s*)/.exec(line)[1].length;
}

/** The scalar value of `key` at exactly `indent`, unquoted. */
function keyValue(block, indent, key) {
  const re = new RegExp(`^ {${indent}}${key}:\\s*(.+?)\\s*$`);
  for (const line of block) {
    const m = re.exec(line);
    if (m) return m[1].replace(/^["']|["']$/g, "");
  }
  return null;
}

/** The child keys of the mapping `key` at `indent`, or null if absent. */
function blockKeys(block, indent, key) {
  const start = block.findIndex((l) => new RegExp(`^ {${indent}}${key}:\\s*$`).test(l));
  if (start === -1) {
    // `args: {}` on one line, or no args at all — both mean "no named arguments".
    return keyValue(block, indent, key) === null ? new Set() : new Set();
  }
  const keys = new Set();
  for (const line of block.slice(start + 1)) {
    if (!line.trim()) continue;
    const at = indentOf(line);
    if (at <= indent) break;
    const m = /^\s*([A-Za-z_]\w*):/.exec(line);
    if (m && at === indentOf(block[start + 1])) keys.add(m[1]);
  }
  return keys;
}

// ── the check ─────────────────────────────────────────────────────────────────

export function checkContractCalls(root = REPO_ROOT) {
  const abi = readAbi(root);
  const frontend = collectFrontendCalls(root);
  const workflows = collectWorkflowCalls(root);
  const all = [
    ...frontend.map((s) => ({ ...s, layer: "frontend" })),
    ...workflows.map((s) => ({ ...s, layer: "workflow" })),
  ];

  const unknownMethod = all.filter((s) => !abi.has(s.method));

  const wrongArgs = [];
  for (const site of all) {
    const params = abi.get(site.method);
    if (!params || site.args === null) continue;
    const missing = [...params].filter((p) => !site.args.has(p));
    const extra = [...site.args].filter((a) => !params.has(a));
    if (missing.length || extra.length) {
      wrongArgs.push({ ...site, expected: [...params].sort(), missing, extra });
    }
  }

  const called = new Set(all.map((s) => s.method));
  const uncalled = [...abi.keys()]
    .filter((m) => !called.has(m) && !(m in UNCALLED_BY_DESIGN))
    .sort();

  // Direction 3, tightened: BOTH layers, not either one.
  //
  // `uncalled` above asks "does anything call this method", which a
  // frontend-only caller satisfies. That is too weak for this repo, and
  // measurably so: when this split was added, eight methods had a frontend
  // caller and no merobox workflow — acl_members_of, acl_revoke_admin,
  // authored_entries, authored_vec_entries and the four *_handler methods — so
  // the admin-rotation path and both authored ITERATORS had never executed
  // against a real node. The frontend call sites proved nothing about them,
  // because the Playwright suite mocks the RPC layer; that is the same blind
  // spot that let 13 phantom `ws_*` methods ship.
  //
  // So the two layers are now reported separately:
  //
  //   * uncalledByFrontend — the scaffold's job is to demonstrate its own
  //     contract surface in the UI, so a method with no UI caller is a missing
  //     demo.
  //   * uncoveredByWorkflow — a method no merobox scenario runs has never been
  //     executed by a real node against a real ABI. This is the half that
  //     actually catches drift.
  const frontendMethods = new Set(frontend.map((s) => s.method));
  const workflowMethods = new Set(workflows.map((s) => s.method));
  const abiMethods = [...abi.keys()].filter((m) => !(m in UNCALLED_BY_DESIGN));
  const uncalledByFrontend = abiMethods.filter((m) => !frontendMethods.has(m)).sort();
  const uncoveredByWorkflow = abiMethods.filter((m) => !workflowMethods.has(m)).sort();

  return {
    abiMethodCount: abi.size,
    frontendCallCount: frontend.length,
    workflowCallCount: workflows.length,
    frontendMethodCount: frontendMethods.size,
    workflowMethodCount: workflowMethods.size,
    unknownMethod,
    wrongArgs,
    uncalled,
    uncalledByFrontend,
    uncoveredByWorkflow,
    ok:
      !unknownMethod.length &&
      !wrongArgs.length &&
      !uncalled.length &&
      !uncalledByFrontend.length &&
      !uncoveredByWorkflow.length,
  };
}

export function formatReport(r) {
  const out = [];
  out.push(
    `ABI: ${r.abiMethodCount} methods · frontend: ${r.frontendCallCount} calls · workflows: ${r.workflowCallCount} calls`,
  );

  if (r.unknownMethod.length) {
    out.push("", `✗ ${r.unknownMethod.length} call(s) to a method the contract does not define:`);
    for (const s of r.unknownMethod) out.push(`    ${s.method}  (${s.layer})  ${s.where}`);
  }

  if (r.wrongArgs.length) {
    out.push("", `✗ ${r.wrongArgs.length} call(s) with the wrong argument names:`);
    for (const s of r.wrongArgs) {
      const bits = [];
      if (s.missing.length) bits.push(`missing ${s.missing.join(", ")}`);
      if (s.extra.length) bits.push(`unexpected ${s.extra.join(", ")}`);
      out.push(`    ${s.method}: ${bits.join("; ")} — contract wants (${s.expected.join(", ")})`);
      out.push(`      ${s.where}`);
    }
  }

  if (r.uncalled.length) {
    out.push(
      "",
      `✗ ${r.uncalled.length} contract method(s) that nothing calls — neither the frontend nor any`,
      "  merobox workflow. Give each one a caller, or add it to UNCALLED_BY_DESIGN with the reason:",
    );
    for (const m of r.uncalled) out.push(`    ${m}`);
  }

  if (r.uncalledByFrontend?.length) {
    out.push(
      "",
      `✗ ${r.uncalledByFrontend.length} contract method(s) with NO frontend caller.`,
      "  This scaffold exists to demonstrate its own contract surface, so a method the UI",
      "  never calls is a missing demo. Add a call site, or UNCALLED_BY_DESIGN with the reason:",
    );
    for (const m of r.uncalledByFrontend) out.push(`    ${m}`);
  }

  if (r.uncoveredByWorkflow?.length) {
    out.push(
      "",
      `✗ ${r.uncoveredByWorkflow.length} contract method(s) that NO merobox workflow runs.`,
      "  A frontend call site is not coverage: the Playwright suite mocks the RPC layer, so a",
      "  method only the UI calls has never executed against a real node. Add it to a scenario",
      "  in logic/workflows/, or UNCALLED_BY_DESIGN with the reason:",
    );
    for (const m of r.uncoveredByWorkflow) out.push(`    ${m}`);
  }

  if (r.ok) {
    out.push(
      "",
      `✓ the frontend, the workflows and the contract agree — all ${r.frontendMethodCount} callable ` +
        `method(s) have BOTH a frontend caller and merobox coverage`,
    );
  }
  return out.join("\n");
}

// CLI
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const report = checkContractCalls();
  console.log(formatReport(report));
  process.exit(report.ok ? 0 : 1);
}

// ── helpers ───────────────────────────────────────────────────────────────────

function* walk(dir, match) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) yield* walk(full, match);
    else if (match.test(name)) yield full;
  }
}

function lineOf(src, index) {
  let line = 1;
  for (let i = 0; i < index; i++) if (src[i] === "\n") line++;
  return line;
}

/** The `{...}` starting at `open`, brace-matched. */
function balanced(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(open, i + 1);
  }
  return null;
}
