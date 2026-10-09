/**
 * The small expression language a lens is written in.
 *
 * A lens is data an AI wrote, run on every event, so it must not be able to do
 * anything but read: no assignment, no loops, no calls but the few functions
 * below, and nothing that reaches outside the values it is handed. A missing
 * value reads as `null` rather than throwing, because an app's payload is
 * not ours to vouch for.
 *
 *   item.sender                      a path into a value
 *   page.messages[0].text            an index
 *   has(item.mentions, me)           a list holds one of your identities
 *   mine(item.sender)                the identity is you
 *   info.context_type == 'Dm' || has(item.mentions_usernames, 'everyone')
 *   '#' + info.name                  joining strings
 *   cond ? a : b                     choosing
 *
 * Functions: has, mine, plain (an editor's HTML as text), len, lower, first,
 * join, str, num, now_s, now_ms. Identifiers are the names the runner binds:
 * `event`, `me`, `context`, each read step's `as`, and `answer` in a reply.
 */

export type Value = unknown;

export type Node =
  | { t: "lit"; v: Value }
  | { t: "id"; name: string }
  | { t: "get"; of: Node; key: Node }
  | { t: "list"; items: Node[] }
  | { t: "call"; fn: string; args: Node[] }
  | { t: "not"; of: Node }
  | { t: "bin"; op: string; a: Node; b: Node }
  | { t: "if"; cond: Node; then: Node; else: Node };

export class ExprError extends Error {}

/** Thrown when an expression reads a value that only exists later (`answer` before you answered). */
export class Deferred extends Error {
  constructor(readonly what: string) {
    super(`${what} is not known yet`);
  }
}

export const FUNCTIONS = ["has", "mine", "plain", "len", "lower", "first", "join", "str", "num", "now_s", "now_ms"] as const;

const MAX_SOURCE = 2_000;
const MAX_DEPTH = 40;

// ── tokenizer ─────────────────────────────────────────────────────────────────

type Tok = { k: "num" | "str" | "id" | "op"; v: string; at: number };

const OPS = ["||", "&&", "==", "!=", "<=", ">=", "<", ">", "+", "!", "?", ":", "(", ")", "[", "]", ".", ","];

function tokenize(src: string): Tok[] {
  if (src.length > MAX_SOURCE) throw new ExprError(`expression longer than ${MAX_SOURCE} characters`);
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (/[0-9]/.test(c)) {
      const m = /^[0-9]+(\.[0-9]+)?/.exec(src.slice(i))!;
      out.push({ k: "num", v: m[0], at: i });
      i += m[0].length;
      continue;
    }
    if (c === "'" || c === '"') {
      let j = i + 1;
      let s = "";
      while (j < src.length && src[j] !== c) {
        if (src[j] === "\\" && j + 1 < src.length) {
          j++;
          s += src[j] === "n" ? "\n" : src[j] === "t" ? "\t" : src[j];
        } else s += src[j];
        j++;
      }
      if (j >= src.length) throw new ExprError(`unclosed string at ${i}`);
      out.push({ k: "str", v: s, at: i });
      i = j + 1;
      continue;
    }
    if (/[A-Za-z_$]/.test(c)) {
      const m = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(src.slice(i))!;
      out.push({ k: "id", v: m[0].replace(/^\$/, ""), at: i });
      i += m[0].length;
      continue;
    }
    const op = OPS.find((o) => src.startsWith(o, i));
    if (!op) throw new ExprError(`unexpected "${c}" at ${i}`);
    out.push({ k: "op", v: op, at: i });
    i += op.length;
  }
  return out;
}

// ── parser (precedence: ?: < || < && < == != < < > <= >= < + < ! < postfix) ─

export function parse(src: string): Node {
  const toks = tokenize(src);
  let p = 0;
  let depth = 0;
  const peek = (v?: string) => (v === undefined ? toks[p] : toks[p]?.k === "op" && toks[p]?.v === v);
  const eat = (v: string) => {
    if (!peek(v)) throw new ExprError(`expected "${v}" at ${toks[p]?.at ?? src.length}`);
    p++;
  };
  const deeper = <T>(f: () => T): T => {
    if (++depth > MAX_DEPTH) throw new ExprError("expression nests too deeply");
    try {
      return f();
    } finally {
      depth--;
    }
  };

  const ternary = (): Node =>
    deeper(() => {
      const cond = or();
      if (!peek("?")) return cond;
      p++;
      const then = ternary();
      eat(":");
      return { t: "if", cond, then, else: ternary() };
    });
  const binary = (ops: string[], next: () => Node) => (): Node => {
    let a = next();
    while (toks[p]?.k === "op" && ops.includes(toks[p]!.v)) {
      const op = toks[p++]!.v;
      a = { t: "bin", op, a, b: next() };
    }
    return a;
  };
  const unary = (): Node =>
    deeper(() => {
      if (peek("!")) {
        p++;
        return { t: "not", of: unary() };
      }
      return postfix();
    });
  const add = binary(["+"], unary);
  const cmp = binary(["<", ">", "<=", ">="], add);
  const eq = binary(["==", "!="], cmp);
  const and = binary(["&&"], eq);
  const or = binary(["||"], and);

  function postfix(): Node {
    let n = primary();
    for (;;) {
      if (peek(".")) {
        p++;
        const t = toks[p++];
        if (t?.k !== "id") throw new ExprError(`expected a name after "." at ${t?.at ?? src.length}`);
        n = { t: "get", of: n, key: { t: "lit", v: t.v } };
      } else if (peek("[")) {
        p++;
        const key = ternary();
        eat("]");
        n = { t: "get", of: n, key };
      } else return n;
    }
  }

  function primary(): Node {
    const t = toks[p++];
    if (!t) throw new ExprError("unexpected end of expression");
    if (t.k === "num") return { t: "lit", v: Number(t.v) };
    if (t.k === "str") return { t: "lit", v: t.v };
    if (t.k === "id") {
      if (t.v === "true") return { t: "lit", v: true };
      if (t.v === "false") return { t: "lit", v: false };
      if (t.v === "null") return { t: "lit", v: null };
      if (peek("(")) {
        if (!(FUNCTIONS as readonly string[]).includes(t.v)) throw new ExprError(`unknown function ${t.v}`);
        p++;
        const args: Node[] = [];
        while (!peek(")")) {
          args.push(ternary());
          if (!peek(")")) eat(",");
        }
        p++;
        return { t: "call", fn: t.v, args };
      }
      return { t: "id", name: t.v };
    }
    if (t.v === "(") {
      const n = ternary();
      eat(")");
      return n;
    }
    if (t.v === "[") {
      const items: Node[] = [];
      while (!peek("]")) {
        items.push(ternary());
        if (!peek("]")) eat(",");
      }
      p++;
      return { t: "list", items };
    }
    throw new ExprError(`unexpected "${t.v}" at ${t.at}`);
  }

  const n = ternary();
  if (p < toks.length) throw new ExprError(`unexpected "${toks[p]!.v}" at ${toks[p]!.at}`);
  return n;
}

/** Every identifier an expression reads, for checking a lens before it runs. */
export function identifiers(src: string): string[] {
  const out = new Set<string>();
  const walk = (n: Node): void => {
    switch (n.t) {
      case "id":
        out.add(n.name);
        return;
      case "get":
        walk(n.of);
        walk(n.key);
        return;
      case "list":
        n.items.forEach(walk);
        return;
      case "call":
        n.args.forEach(walk);
        return;
      case "not":
        walk(n.of);
        return;
      case "bin":
        walk(n.a);
        walk(n.b);
        return;
      case "if":
        walk(n.cond);
        walk(n.then);
        walk(n.else);
        return;
      case "lit":
        return;
    }
  };
  walk(parse(src));
  return [...out];
}

// ── evaluation ────────────────────────────────────────────────────────────────

export interface Scope {
  /** Bound names: `event`, step results, `context`, `answer`. */
  vars: Record<string, Value>;
  /** Your identities, every form an app may write them in. */
  me: Set<string>;
  /** Names that are known only later; reading one throws {@link Deferred}. */
  deferred?: Set<string>;
  now?: () => number;
}

const truthy = (v: Value) => !(v === null || v === undefined || v === false || v === 0 || v === "");

function get(of: Value, key: Value): Value {
  if (of === null || of === undefined) return null;
  if (Array.isArray(of)) {
    if (key === "length") return of.length;
    const i = typeof key === "number" ? key : Number(key);
    return Number.isInteger(i) ? (of[i < 0 ? of.length + i : i] ?? null) : null;
  }
  if (typeof of === "object") {
    const k = String(key);
    return Object.prototype.hasOwnProperty.call(of, k) ? ((of as Record<string, Value>)[k] ?? null) : null;
  }
  if (typeof of === "string" && key === "length") return of.length;
  return null;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", nbsp: " " };

/** An editor's HTML as you would read it. */
export function plainText(html: string): string {
  return html
    .replace(/<br\s*\/?>|<\/p>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_, e: string) => ENTITIES[e] ?? "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function isMe(v: Value, me: Set<string>): boolean {
  return typeof v === "string" && me.has(v);
}

export function evaluate(src: string, scope: Scope): Value {
  return run(parse(src), scope);
}

function run(n: Node, s: Scope): Value {
  switch (n.t) {
    case "lit":
      return n.v;
    case "id":
      if (s.deferred?.has(n.name)) throw new Deferred(n.name);
      if (n.name === "me") return [...s.me];
      return Object.prototype.hasOwnProperty.call(s.vars, n.name) ? (s.vars[n.name] ?? null) : null;
    case "get":
      return get(run(n.of, s), run(n.key, s));
    case "list":
      return n.items.map((i) => run(i, s));
    case "not":
      return !truthy(run(n.of, s));
    case "if":
      return truthy(run(n.cond, s)) ? run(n.then, s) : run(n.else, s);
    case "bin": {
      if (n.op === "||") {
        const a = run(n.a, s);
        return truthy(a) ? a : run(n.b, s);
      }
      if (n.op === "&&") {
        const a = run(n.a, s);
        return truthy(a) ? run(n.b, s) : a;
      }
      const a = run(n.a, s);
      const b = run(n.b, s);
      switch (n.op) {
        case "==":
          return a === b || (a == null && b == null);
        case "!=":
          return !(a === b || (a == null && b == null));
        case "+":
          return typeof a === "number" && typeof b === "number" ? a + b : `${a ?? ""}${b ?? ""}`;
        case "<":
          return Number(a) < Number(b);
        case ">":
          return Number(a) > Number(b);
        case "<=":
          return Number(a) <= Number(b);
        case ">=":
          return Number(a) >= Number(b);
      }
      throw new ExprError(`unknown operator ${n.op}`);
    }
    case "call":
      return callFn(n, s);
  }
}

function callFn(n: Extract<Node, { t: "call" }>, s: Scope): Value {
  // `has(list, me)` means "holds one of your identities", not "holds the list".
  if (n.fn === "has") {
    const list = run(n.args[0]!, s);
    if (!Array.isArray(list)) return false;
    const needle = n.args[1]!;
    if (needle.t === "id" && needle.name === "me") return list.some((x) => isMe(x, s.me));
    const v = run(needle, s);
    return list.some((x) => x === v);
  }
  const args = n.args.map((a) => run(a, s));
  const [a, b] = args;
  switch (n.fn) {
    case "mine":
      return isMe(a, s.me);
    case "plain":
      return typeof a === "string" ? plainText(a) : "";
    case "len":
      return Array.isArray(a) || typeof a === "string" ? a.length : 0;
    case "lower":
      return typeof a === "string" ? a.toLowerCase() : "";
    case "first":
      return Array.isArray(a) ? (a[0] ?? null) : null;
    case "join":
      return Array.isArray(a) ? a.map((x) => String(x ?? "")).join(typeof b === "string" ? b : ", ") : "";
    case "str":
      return a === null || a === undefined ? "" : typeof a === "object" ? JSON.stringify(a) : String(a);
    case "num":
      return Number(a ?? 0);
    case "now_s":
    case "now_ms": {
      if (s.deferred?.has(n.fn)) throw new Deferred(n.fn);
      const ms = (s.now ?? Date.now)();
      return n.fn === "now_s" ? Math.floor(ms / 1000) : ms;
    }
  }
  throw new ExprError(`unknown function ${n.fn}`);
}
