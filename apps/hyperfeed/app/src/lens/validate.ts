import { FUNCTIONS, identifiers, parse, type Node } from "./expr";
import { ITEM_TYPES, type EventLens, type LensSpec } from "./lens";

/**
 * Checks a lens against the app's ABI before anyone relies on it.
 *
 * The agent that wrote the lens gets every problem back as one line and fixes
 * it; nothing that fails here is proposed to you. What it checks:
 *
 * - every event it names is one the app emits;
 * - a read step calls a read-only method that exists, with arguments the
 *   method takes, and every argument the method requires;
 * - a reply calls a mutating method with every argument it requires, and puts
 *   your answer in it when you answer by replying;
 * - every expression parses and reads only names that exist where it runs,
 *   and every path it reads (`page.messages[0].text`) exists in the type the
 *   ABI gives the event's payload or the read's result;
 * - fields are the item type's own.
 */

export interface Abi {
  methods: { name: string; params: { name: string; type?: unknown; nullable?: boolean }[]; intent?: string; returns?: unknown }[];
  events: { name: string; payload?: unknown }[];
  types?: Record<string, unknown>;
}

/** An ABI type: `{ kind, fields?, items?, variants? }` or `{ $ref }`. */
type AbiType = { kind?: string; $ref?: string; fields?: { name: string; type?: unknown }[]; items?: unknown; variants?: unknown[] } | undefined;

const LATER = new Set(["answer", "now_s", "now_ms"]);
const ALWAYS = new Set(["event", "me", "context"]);

export function validateLens(spec: LensSpec, abi: Abi): string[] {
  const problems: string[] = [];
  if (spec?.version !== 1) problems.push('version must be 1');
  if (!spec?.events || typeof spec.events !== "object") return [...problems, "events must be an object"];
  const events = new Set(abi.events.map((e) => e.name));
  const methods = new Map(abi.methods.map((m) => [m.name, m]));
  for (const [kind, lens] of Object.entries(spec.events)) {
    const at = (what: string) => `${kind}: ${what}`;
    if (!events.has(kind)) problems.push(at(`the app emits no event ${kind}`));
    if (lens === "ignore") continue;
    if (!lens || typeof lens !== "object") {
      problems.push(at('must be "ignore" or an object'));
      continue;
    }
    const payload = (abi.events.find((e) => e.name === kind)?.payload ?? undefined) as AbiType;
    problems.push(...checkEvent(lens, methods, abi.types ?? {}, payload).map(at));
  }
  return problems;
}

function checkEvent(lens: EventLens, methods: Map<string, Abi["methods"][number]>, types: Record<string, unknown>, payload: AbiType): string[] {
  const out: string[] = [];
  const type = ITEM_TYPES[lens.type];
  if (!type) return [`type must be one of ${Object.keys(ITEM_TYPES).join(", ")}`];
  const known = new Set(ALWAYS);
  // What each name holds, where the ABI says: the payload, each read's result, each let that is a path.
  const typeOf = new Map<string, AbiType>([["event", payload]]);

  const exprs = (value: unknown, where: string, allowLater: boolean) => {
    for (const src of expressionsIn(value)) {
      let ids: string[];
      try {
        ids = identifiers(src);
      } catch (e) {
        out.push(`${where}: ${e instanceof Error ? e.message : String(e)} in "=${src}"`);
        continue;
      }
      const later = ids.filter((i) => LATER.has(i)).length > 0 || /\bnow_(s|ms)\s*\(/.test(src);
      if (later && !allowLater) out.push(`${where}: "answer" and now_s() exist only in reply args`);
      if (later && allowLater && ids.some((i) => !LATER.has(i) && !(FUNCTIONS as readonly string[]).includes(i))) {
        out.push(`${where}: an expression that reads the answer or the time reads nothing else ("=${src}")`);
      }
      for (const id of ids) {
        if (!known.has(id) && !LATER.has(id)) out.push(`${where}: unknown name ${id} in "=${src}"`);
      }
      for (const problem of checkPaths(parse(src), typeOf, types)) out.push(`${where}: ${problem} in "=${src}"`);
    }
  };

  for (const [i, step] of (lens.read ?? []).entries()) {
    const where = `read[${i}]`;
    if (!step?.as || !/^[a-z_][a-z0-9_]*$/i.test(step.as)) out.push(`${where}: "as" must be a name`);
    if (ALWAYS.has(step?.as) || LATER.has(step?.as)) out.push(`${where}: "${step.as}" is a reserved name`);
    const m = methods.get(step?.call);
    if (!m) out.push(`${where}: the app has no method ${step?.call}`);
    else {
      if (m.intent !== "read_only") out.push(`${where}: ${step.call} changes state; a lens may only read`);
      out.push(...checkArgs(step.args ?? {}, m, where));
    }
    exprs(step?.args, where, false);
    if (step?.as) {
      known.add(step.as);
      typeOf.set(step.as, m?.returns as AbiType);
    }
  }
  for (const [name, src] of Object.entries(lens.let ?? {})) {
    exprs(src, `let.${name}`, false);
    known.add(name);
    if (typeof src === "string" && src.startsWith("=")) {
      try {
        typeOf.set(name, typeOfPath(parse(src.slice(1)), typeOf, types));
      } catch {
        // reported by exprs above
      }
    }
  }
  if (lens.show_if !== undefined) exprs(lens.show_if, "show_if", false);
  for (const k of Object.keys(lens.fields ?? {})) {
    if (!(k in type.fields)) out.push(`fields.${k}: a ${lens.type} has no field ${k} (it has ${Object.keys(type.fields).join(", ")})`);
  }
  exprs(lens.fields, "fields", false);
  if (lens.title !== undefined) exprs(lens.title, "title", false);
  if (typeof lens.needs_you === "string") exprs(lens.needs_you, "needs_you", false);
  if (lens.ask) {
    if (!["reply", "choose", "confirm"].includes(lens.ask.kind)) out.push("ask.kind must be reply, choose or confirm");
    exprs(lens.ask, "ask", false);
  }
  if (lens.reply) {
    const m = methods.get(lens.reply.method);
    if (!m) out.push(`reply: the app has no method ${lens.reply.method}`);
    else {
      if (m.intent === "read_only") out.push(`reply: ${lens.reply.method} only reads; a reply must change something`);
      out.push(...checkArgs(lens.reply.args ?? {}, m, "reply"));
    }
    exprs(lens.reply.args, "reply", true);
    const kind = lens.ask?.kind ?? (ITEM_TYPES[lens.type]?.ask({}).kind as string);
    const usesAnswer = expressionsIn(lens.reply.args).some((src) => /\banswer\b/.test(src));
    if (kind !== "confirm" && !usesAnswer) out.push("reply: the args never use answer, so your reply or pick would be lost");
  } else if (lens.ask) {
    out.push("ask: without a reply call there is nothing to answer with");
  }
  return out;
}

function checkArgs(args: Record<string, unknown>, m: Abi["methods"][number], where: string): string[] {
  const out: string[] = [];
  if (!args || typeof args !== "object" || Array.isArray(args)) return [`${where}: args must be an object`];
  const params = new Map(m.params.map((p) => [p.name, p]));
  for (const k of Object.keys(args)) if (!params.has(k)) out.push(`${where}: ${m.name} takes no argument ${k}`);
  for (const p of m.params) {
    if (!p.nullable && !(p.name in args)) out.push(`${where}: ${m.name} needs ${p.name}`);
    const t = p.type as { kind?: string; $ref?: string } | undefined;
    const v = args[p.name];
    if (t?.$ref && v !== undefined && v !== null && typeof v !== "string") {
      // A struct argument is built by the app's own client (a sealed ballot,
      // an upload); a lens can only pass one it read.
      out.push(`${where}: ${p.name} is a ${t.$ref} the lens cannot build`);
    }
    if (t?.kind && /^[ui](8|16|32|64|128)$/.test(t.kind) && typeof v === "string" && !v.startsWith("=")) {
      out.push(`${where}: ${p.name} is a number, not "${v}"`);
    }
  }
  return out;
}

/** The `=expr` strings anywhere in a value. */
function expressionsIn(value: unknown): string[] {
  if (typeof value === "string") return value.startsWith("=") ? [value.slice(1)] : [];
  if (Array.isArray(value)) return value.flatMap(expressionsIn);
  if (value && typeof value === "object") return Object.values(value).flatMap(expressionsIn);
  return [];
}

function resolveType(t: AbiType, types: Record<string, unknown>): AbiType {
  let cur = t;
  for (let i = 0; cur?.$ref && i < 20; i++) cur = types[cur.$ref] as AbiType;
  return cur;
}

/** The ABI type a pure path expression reads (`p.definition`), or undefined when it is not one. */
function typeOfPath(n: Node, typeOf: Map<string, AbiType>, types: Record<string, unknown>): AbiType {
  if (n.t === "id") return typeOf.get(n.name);
  if (n.t !== "get") return undefined;
  const of = resolveType(typeOfPath(n.of, typeOf, types), types);
  if (!of) return undefined;
  if (of.kind === "list") return of.items as AbiType;
  if (of.kind === "map") return (of as { value?: unknown }).value as AbiType;
  const key = n.key;
  if (key.t === "lit" && typeof key.v === "string" && of.fields) {
    return of.fields.find((f) => f.name === key.v)?.type as AbiType;
  }
  return undefined;
}

/**
 * Every `a.b.c` in an expression whose start has an ABI type: each step must be
 * a field the type has. An invented field reads as null and quietly drops
 * every event, so it is caught here instead.
 */
function checkPaths(n: Node, typeOf: Map<string, AbiType>, types: Record<string, unknown>): string[] {
  const out: string[] = [];
  const walk = (x: Node): void => {
    if (x.t === "get") {
      const of = resolveType(typeOfPath(x.of, typeOf, types), types);
      if (of?.kind === "record" && of.fields && x.key.t === "lit" && typeof x.key.v === "string" && x.key.v !== "length") {
        const key = x.key.v;
        if (!of.fields.some((f) => f.name === key)) {
          out.push(`${describe(x.of)} has no field ${key} (it has ${of.fields.map((f) => f.name).join(", ")})`);
        }
      }
      walk(x.of);
      walk(x.key);
      return;
    }
    if (x.t === "list") x.items.forEach(walk);
    else if (x.t === "call") x.args.forEach(walk);
    else if (x.t === "not") walk(x.of);
    else if (x.t === "bin") {
      walk(x.a);
      walk(x.b);
    } else if (x.t === "if") {
      walk(x.cond);
      walk(x.then);
      walk(x.else);
    }
  };
  walk(n);
  return out;
}

function describe(n: Node): string {
  if (n.t === "id") return n.name;
  if (n.t === "get") return `${describe(n.of)}${n.key.t === "lit" && typeof n.key.v === "string" ? `.${n.key.v}` : "[…]"}`;
  return "a value";
}

