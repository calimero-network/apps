import { useState, useCallback } from "react";
import * as api from "../api/kvStore";


// Node wraps WASM errors as: { error: { name, cause: { info: { message } } } }
// and method-not-found as the same shape. Extract the human-readable message.
// Some WASM errors encode the message as a byte array like [34, 87, 111, ...]
// inside the message string — decode those to readable text.
function decodeByteArray(msg: string): string {
  return msg.replace(/\[(\d+(?:,\s*\d+)*)\]/, (_, inner: string) => {
    try {
      const bytes = inner.split(",").map((s: string) => parseInt(s.trim(), 10));
      const decoded = String.fromCharCode(...bytes);
      try { return JSON.parse(decoded); } catch { return decoded; }
    } catch {
      return _;
    }
  });
}

function extractErrMsg(error: unknown): string {
  const e = error as { message?: string; cause?: { info?: { message?: string } } };
  // Use || not ?? — the node sets error.message="" (empty string) for execution
  // errors; the real message lives in cause.info.message.
  const raw = e?.message || e?.cause?.info?.message || JSON.stringify(error);
  return decodeByteArray(raw);
}

function out<T>(res: unknown): T {
  const r = res as { result?: { output?: T }; error?: unknown };
  if (r?.error) throw new Error(extractErrMsg(r.error));
  return r?.result?.output as T;
}

function outOrNull<T>(res: unknown): T | null {
  const r = res as { result?: { output?: T }; error?: unknown };
  if (r?.error) throw new Error(extractErrMsg(r.error));
  return r?.result?.output ?? null;
}

function noErr(res: unknown): void {
  const r = res as { error?: unknown };
  if (r?.error) throw new Error(extractErrMsg(r.error));
}

function expectErr(res: unknown): void {
  const r = res as { error?: unknown };
  if (!r?.error) throw new Error("expected error response but call succeeded");
}

function eq<T>(actual: T, expected: T, msg?: string): void {
  if (actual !== expected)
    throw new Error(msg ?? `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function gte(actual: number, min: number): void {
  if (actual < min) throw new Error(`expected >= ${min}, got ${actual}`);
}

function isArray(val: unknown): void {
  if (!Array.isArray(val)) throw new Error(`expected array, got ${typeof val}`);
}

function notEmpty(val: string | null | undefined, msg?: string): void {
  if (!val || val.length === 0) throw new Error(msg ?? "expected non-empty string");
}

function contains(haystack: string, needle: string): void {
  if (!haystack.includes(needle))
    throw new Error(`"${haystack}" does not contain "${needle}"`);
}

function matches(val: string, re: RegExp, what: string): void {
  if (typeof val !== "string" || !re.test(val))
    throw new Error(`expected ${what}, got ${JSON.stringify(val)}`);
}


type Status = "idle" | "running" | "pass" | "fail";

interface TestCase {
  id: string;
  name: string;
  group: string;
  fn: (runId: string) => Promise<void>;
}

const TESTS: TestCase[] = [
  {
    id: "whoami-shape",
    name: "whoami returns a base58 device id and a 64-hex account id",
    group: "Identity",
    fn: async () => {
      const me = out<api.Identity>(await api.whoami());
      // The two ids are different encodings of different things; asserting the
      // shapes is what catches a regression that returns one where the other
      // belongs, which would otherwise only show up as a silent permission
      // failure in the Shared Storage group.
      matches(me.device_id, /^[1-9A-HJ-NP-Za-km-z]+$/, "a base58 device id");
      matches(me.account_id, /^[0-9a-f]{64}$/, "a 64-hex account id");
    },
  },
  {
    id: "whoami-stable",
    name: "whoami is stable across calls",
    group: "Identity",
    fn: async () => {
      const a = out<api.Identity>(await api.whoami());
      const b = out<api.Identity>(await api.whoami());
      eq(a.device_id, b.device_id);
      eq(a.account_id, b.account_id);
    },
  },

  {
    id: "kv-set-get",
    name: "set + get round-trip",
    group: "KV Operations",
    fn: async (r) => {
      noErr(await api.kvSet(`${r}_k`, "hello"));
      eq(out<string | null>(await api.kvGet(`${r}_k`)), "hello");
    },
  },
  {
    id: "kv-get-missing",
    name: "get missing key → null",
    group: "KV Operations",
    fn: async (r) => {
      eq(outOrNull<string>(await api.kvGet(`${r}_missing_xyzzy`)), null);
    },
  },
  {
    id: "kv-entries",
    name: "entries contains set key",
    group: "KV Operations",
    fn: async (r) => {
      noErr(await api.kvSet(`${r}_ent`, "v"));
      const map = out<Record<string, string>>(await api.kvEntries());
      if (!(`${r}_ent` in map)) throw new Error("key not found in entries");
    },
  },
  {
    id: "kv-len",
    name: "len increases after set",
    group: "KV Operations",
    fn: async (r) => {
      const before = out<number>(await api.kvLen());
      noErr(await api.kvSet(`${r}_len`, "v"));
      gte(out<number>(await api.kvLen()), before + 1);
    },
  },
  {
    id: "kv-remove",
    name: "remove + get → null",
    group: "KV Operations",
    fn: async (r) => {
      noErr(await api.kvSet(`${r}_rm`, "bye"));
      noErr(await api.kvRemove(`${r}_rm`));
      eq(outOrNull<string>(await api.kvGet(`${r}_rm`)), null);
    },
  },
  {
    id: "kv-clear",
    name: "clear runs without error",
    group: "KV Operations",
    fn: async () => {
      noErr(await api.kvClear());
    },
  },
  {
    id: "kv-set-with-handler",
    name: "set_with_handler sets key (handler fires on peer nodes)",
    group: "KV Operations",
    fn: async (r) => {
      noErr(await api.kvSetWithHandler(`${r}_hwk`, "hwv"));
      eq(out<string | null>(await api.kvGet(`${r}_hwk`)), "hwv");
    },
  },
  {
    id: "kv-get-result",
    name: "get_result returns value after set",
    group: "KV Operations",
    fn: async (r) => {
      noErr(await api.kvSet(`${r}_gr`, "result-val"));
      const v = out<string>(await api.kvGetResult(`${r}_gr`));
      eq(v, "result-val");
    },
  },

  {
    id: "kv-overwrite",
    name: "overwrite key → get returns latest value",
    group: "KV Operations",
    fn: async (r) => {
      noErr(await api.kvSet(`${r}_ow`, "first"));
      noErr(await api.kvSet(`${r}_ow`, "second"));
      eq(out<string | null>(await api.kvGet(`${r}_ow`)), "second");
    },
  },
  {
    id: "kv-remove-missing",
    name: "remove non-existent key → null (no error)",
    group: "KV Operations",
    fn: async (r) => {
      eq(outOrNull<string>(await api.kvRemove(`${r}_no_such_xyzzy`)), null);
    },
  },
  {
    id: "kv-get-after-clear",
    name: "key is gone after clear",
    group: "KV Operations",
    fn: async (r) => {
      noErr(await api.kvSet(`${r}_clr`, "before"));
      noErr(await api.kvClear());
      eq(outOrNull<string>(await api.kvGet(`${r}_clr`)), null);
    },
  },
  {
    id: "kv-len-after-remove",
    name: "len decreases after remove",
    group: "KV Operations",
    fn: async (r) => {
      noErr(await api.kvSet(`${r}_lenrm`, "v"));
      const after_set = out<number>(await api.kvLen());
      noErr(await api.kvRemove(`${r}_lenrm`));
      const after_remove = out<number>(await api.kvLen());
      if (after_remove >= after_set)
        throw new Error(`len should shrink after remove: ${after_set} → ${after_remove}`);
    },
  },

  {
    id: "handler-insert",
    name: "insert_handler increments counter",
    group: "KV Handlers",
    fn: async (r) => {
      const before = out<number>(await api.getHandlerExecutionCount());
      noErr(await api.insertHandler(`${r}_ih`, "v"));
      gte(out<number>(await api.getHandlerExecutionCount()), before + 1);
    },
  },
  {
    id: "handler-update",
    name: "update_handler increments counter",
    group: "KV Handlers",
    fn: async (r) => {
      noErr(await api.kvSet(`${r}_uh`, "old"));
      const before = out<number>(await api.getHandlerExecutionCount());
      noErr(await api.updateHandler(`${r}_uh`, "new"));
      gte(out<number>(await api.getHandlerExecutionCount()), before + 1);
    },
  },
  {
    id: "handler-remove",
    name: "remove_with_handler removes key",
    group: "KV Handlers",
    fn: async (r) => {
      noErr(await api.kvSet(`${r}_rh`, "todel"));
      noErr(await api.kvRemoveWithHandler(`${r}_rh`));
      eq(outOrNull<string>(await api.kvGet(`${r}_rh`)), null);
    },
  },
  {
    id: "handler-count",
    name: "execution count > 0 after handler calls",
    group: "KV Handlers",
    fn: async () => {
      gte(out<number>(await api.getHandlerExecutionCount()), 1);
    },
  },

  {
    id: "handler-clear-with-handler",
    name: "clear_with_handler clears store (handler fires on peer nodes)",
    group: "KV Handlers",
    fn: async (r) => {
      noErr(await api.kvSet(`${r}_cwh`, "v"));
      noErr(await api.kvClearWithHandler());
      eq(outOrNull<string>(await api.kvGet(`${r}_cwh`)), null);
    },
  },
  {
    id: "handler-remove-missing-with-handler",
    name: "remove_with_handler on missing key → null without error",
    group: "KV Handlers",
    fn: async (r) => {
      eq(outOrNull<string>(await api.kvRemoveWithHandler(`${r}_no_rh_xyz`)), null);
    },
  },

  {
    id: "user-simple",
    name: "set_user_simple + get_user_simple round-trip",
    group: "User Storage",
    fn: async (r) => {
      noErr(await api.setUserSimple(`usr_${r}`));
      eq(out<string | null>(await api.getUserSimple()), `usr_${r}`);
    },
  },
  {
    id: "user-nested",
    name: "set_user_nested + get_user_nested round-trip",
    group: "User Storage",
    fn: async (r) => {
      noErr(await api.setUserNested(`nk_${r}`, `nv_${r}`));
      eq(out<string | null>(await api.getUserNested(`nk_${r}`)), `nv_${r}`);
    },
  },

  {
    id: "user-simple-for-self",
    name: "get_user_simple_for own account id returns stored value",
    group: "User Storage",
    fn: async (r) => {
      // The account, not getContextIdentity()'s device key — rc.21 rekeyed
      // UserStorage by account. Passing the device key returns null, which
      // would read as "nothing stored" rather than as a wrong address.
      const myAccount = out<api.Identity>(await api.whoami()).account_id;
      noErr(await api.setUserSimple(`self_${r}`));
      eq(out<string | null>(await api.getUserSimpleFor(myAccount)), `self_${r}`);
    },
  },
  {
    id: "user-nested-multiple",
    name: "multiple nested keys are independent",
    group: "User Storage",
    fn: async (r) => {
      noErr(await api.setUserNested(`nk1_${r}`, `nv1_${r}`));
      noErr(await api.setUserNested(`nk2_${r}`, `nv2_${r}`));
      eq(out<string | null>(await api.getUserNested(`nk1_${r}`)), `nv1_${r}`);
      eq(out<string | null>(await api.getUserNested(`nk2_${r}`)), `nv2_${r}`);
    },
  },
  {
    id: "user-overwrite-simple",
    name: "overwrite user_simple → get returns new value",
    group: "User Storage",
    fn: async (r) => {
      noErr(await api.setUserSimple(`first_${r}`));
      noErr(await api.setUserSimple(`second_${r}`));
      eq(out<string | null>(await api.getUserSimple()), `second_${r}`);
    },
  },

  {
    id: "frozen-hash",
    name: "add_frozen returns non-empty hash",
    group: "Frozen Storage",
    fn: async (r) => {
      const h = out<string>(await api.addFrozen(`frozen_${r}`));
      notEmpty(h, "expected a hash string");
    },
  },
  {
    id: "frozen-get",
    name: "get_frozen returns original value",
    group: "Frozen Storage",
    fn: async (r) => {
      const val = `content_${r}`;
      const h = out<string>(await api.addFrozen(val));
      eq(out<string>(await api.getFrozen(h)), val);
    },
  },
  {
    id: "frozen-dedup",
    name: "duplicate add returns same hash",
    group: "Frozen Storage",
    fn: async (r) => {
      const val = `dedup_${r}`;
      const h1 = out<string>(await api.addFrozen(val));
      const h2 = out<string>(await api.addFrozen(val));
      eq(h1, h2, "duplicate inserts must return the same hash");
    },
  },

  {
    id: "frozen-different-values",
    name: "distinct inputs produce distinct hashes",
    group: "Frozen Storage",
    fn: async (r) => {
      const h1 = out<string>(await api.addFrozen(`fa_${r}`));
      const h2 = out<string>(await api.addFrozen(`fb_${r}`));
      if (h1 === h2) throw new Error("distinct values must not share a hash");
    },
  },
  {
    id: "frozen-large-value",
    name: "100-char value round-trips correctly",
    group: "Frozen Storage",
    fn: async (r) => {
      const val = `${"x".repeat(100)}_${r}`;
      const h = out<string>(await api.addFrozen(val));
      eq(out<string>(await api.getFrozen(h)), val);
    },
  },

  {
    id: "private-correct",
    name: "correct guess → true",
    group: "Private Storage",
    fn: async (r) => {
      noErr(await api.addSecret(`g_${r}`, "secret"));
      eq(out<boolean>(await api.addGuess(`g_${r}`, "secret")), true);
    },
  },
  {
    id: "private-wrong",
    name: "wrong guess → false",
    group: "Private Storage",
    fn: async (r) => {
      noErr(await api.addSecret(`g2_${r}`, "secret"));
      eq(out<boolean>(await api.addGuess(`g2_${r}`, "wrong")), false);
    },
  },
  {
    id: "private-my-secrets",
    name: "my_secrets returns object",
    group: "Private Storage",
    fn: async (r) => {
      noErr(await api.addSecret(`gs_${r}`, "s"));
      const s = out<Record<string, string>>(await api.mySecrets());
      if (typeof s !== "object" || s === null) throw new Error("expected object");
    },
  },
  {
    id: "private-games",
    name: "games returns object with public hashes",
    group: "Private Storage",
    fn: async (r) => {
      noErr(await api.addSecret(`gg_${r}`, "s"));
      const g = out<Record<string, string>>(await api.games());
      if (typeof g !== "object" || g === null) throw new Error("expected object");
    },
  },

  {
    id: "private-multiple-games",
    name: "secrets for two game IDs are tracked independently",
    group: "Private Storage",
    fn: async (r) => {
      noErr(await api.addSecret(`gA_${r}`, "secretA"));
      noErr(await api.addSecret(`gB_${r}`, "secretB"));
      eq(out<boolean>(await api.addGuess(`gA_${r}`, "secretA")), true);
      eq(out<boolean>(await api.addGuess(`gB_${r}`, "secretB")), true);
      eq(out<boolean>(await api.addGuess(`gA_${r}`, "secretB")), false);
    },
  },

  {
    id: "blob-list",
    name: "list_files returns array",
    group: "Blob Storage",
    fn: async () => {
      isArray(out<unknown[]>(await api.listFiles()));
    },
  },
  {
    id: "blob-search",
    name: "search_files returns array",
    group: "Blob Storage",
    fn: async () => {
      isArray(out<unknown[]>(await api.searchFiles("test")));
    },
  },

  {
    id: "blob-get-nonexistent",
    name: "getFile for unknown id → error response",
    group: "Blob Storage",
    fn: async () => {
      expectErr(await api.getFile("nonexistent_file_id_xyz_123"));
    },
  },

  {
    id: "gctr-increment",
    name: "increment returns >= 1",
    group: "CRDT Counters",
    fn: async (r) => {
      gte(out<number>(await api.incrementGCounter(`gc_${r}`)), 1);
    },
  },
  {
    id: "gctr-monotone",
    name: "second increment > first",
    group: "CRDT Counters",
    fn: async (r) => {
      const v1 = out<number>(await api.incrementGCounter(`gc2_${r}`));
      const v2 = out<number>(await api.incrementGCounter(`gc2_${r}`));
      if (v2 <= v1) throw new Error(`v2 (${v2}) should be > v1 (${v1})`);
    },
  },
  {
    id: "gctr-get",
    name: "get_g_counter matches last increment",
    group: "CRDT Counters",
    fn: async (r) => {
      const inc = out<number>(await api.incrementGCounter(`gc3_${r}`));
      const got = out<number>(await api.getGCounter(`gc3_${r}`));
      eq(inc, got);
    },
  },

  {
    id: "pnctr-increment",
    name: "increment returns >= 1",
    group: "CRDT Counters",
    fn: async (r) => {
      noErr(await api.incrementPnCounter(`pn_${r}`));
      gte(out<number>(await api.getPnCounter(`pn_${r}`)), 1);
    },
  },
  {
    id: "pnctr-decrement",
    name: "decrement lowers value",
    group: "CRDT Counters",
    fn: async (r) => {
      const k = `pn2_${r}`;
      noErr(await api.incrementPnCounter(k));
      noErr(await api.incrementPnCounter(k));
      const before = out<number>(await api.getPnCounter(k));
      noErr(await api.decrementPnCounter(k));
      const after = out<number>(await api.getPnCounter(k));
      if (after >= before) throw new Error(`${after} should be < ${before}`);
    },
  },

  {
    id: "gctr-independent-keys",
    name: "two fresh g-counter keys start at 1 after first increment each",
    group: "CRDT Counters",
    fn: async (r) => {
      const a = out<number>(await api.incrementGCounter(`gcia_${r}`));
      const b = out<number>(await api.incrementGCounter(`gcib_${r}`));
      eq(a, 1);
      eq(b, 1);
    },
  },
  {
    id: "pnctr-net-result",
    name: "increment + increment + decrement → net value >= 1",
    group: "CRDT Counters",
    fn: async (r) => {
      const k = `pnn_${r}`;
      noErr(await api.incrementPnCounter(k));
      noErr(await api.incrementPnCounter(k));
      noErr(await api.decrementPnCounter(k));
      gte(out<number>(await api.getPnCounter(k)), 1);
    },
  },

  {
    id: "reg-set-get",
    name: "set + get round-trip",
    group: "CRDT Registers",
    fn: async (r) => {
      noErr(await api.setRegister(`reg_${r}`, `val_${r}`));
      eq(out<string>(await api.getRegister(`reg_${r}`)), `val_${r}`);
    },
  },
  {
    id: "reg-overwrite",
    name: "overwrite returns new value",
    group: "CRDT Registers",
    fn: async (r) => {
      noErr(await api.setRegister(`reg2_${r}`, "old"));
      noErr(await api.setRegister(`reg2_${r}`, "new"));
      eq(out<string>(await api.getRegister(`reg2_${r}`)), "new");
    },
  },

  {
    id: "reg-independent-keys",
    name: "two register keys are independent",
    group: "CRDT Registers",
    fn: async (r) => {
      noErr(await api.setRegister(`ri1_${r}`, "alpha"));
      noErr(await api.setRegister(`ri2_${r}`, "beta"));
      eq(out<string>(await api.getRegister(`ri1_${r}`)), "alpha");
      eq(out<string>(await api.getRegister(`ri2_${r}`)), "beta");
    },
  },
  {
    id: "reg-exact-value",
    name: "register stores exact string including spaces and symbols",
    group: "CRDT Registers",
    fn: async (r) => {
      const val = `hello world! 123 ${r}`;
      noErr(await api.setRegister(`re_${r}`, val));
      eq(out<string>(await api.getRegister(`re_${r}`)), val);
    },
  },

  {
    id: "meta-set-get",
    name: "set_metadata + get_metadata round-trip",
    group: "CRDT Metadata",
    fn: async (r) => {
      noErr(await api.setMetadata(`o_${r}`, `i_${r}`, `mv_${r}`));
      eq(out<string>(await api.getMetadata(`o_${r}`, `i_${r}`)), `mv_${r}`);
    },
  },
  {
    id: "meta-overwrite",
    name: "overwrite inner key returns new value",
    group: "CRDT Metadata",
    fn: async (r) => {
      noErr(await api.setMetadata(`o2_${r}`, `i2_${r}`, "old"));
      noErr(await api.setMetadata(`o2_${r}`, `i2_${r}`, "new"));
      eq(out<string>(await api.getMetadata(`o2_${r}`, `i2_${r}`)), "new");
    },
  },

  {
    id: "meta-multiple-inner-keys",
    name: "three inner keys under same outer key are all readable",
    group: "CRDT Metadata",
    fn: async (r) => {
      noErr(await api.setMetadata(`mo_${r}`, `i1_${r}`, "v1"));
      noErr(await api.setMetadata(`mo_${r}`, `i2_${r}`, "v2"));
      noErr(await api.setMetadata(`mo_${r}`, `i3_${r}`, "v3"));
      eq(out<string>(await api.getMetadata(`mo_${r}`, `i1_${r}`)), "v1");
      eq(out<string>(await api.getMetadata(`mo_${r}`, `i2_${r}`)), "v2");
      eq(out<string>(await api.getMetadata(`mo_${r}`, `i3_${r}`)), "v3");
    },
  },
  {
    id: "meta-outer-isolated",
    name: "different outer keys share same inner key name without collision",
    group: "CRDT Metadata",
    fn: async (r) => {
      noErr(await api.setMetadata(`ox1_${r}`, `ik_${r}`, "vx1"));
      noErr(await api.setMetadata(`ox2_${r}`, `ik_${r}`, "vx2"));
      eq(out<string>(await api.getMetadata(`ox1_${r}`, `ik_${r}`)), "vx1");
      eq(out<string>(await api.getMetadata(`ox2_${r}`, `ik_${r}`)), "vx2");
    },
  },

  {
    id: "metrics-len",
    name: "push increases length",
    group: "CRDT Metrics",
    fn: async () => {
      const before = out<number>(await api.metricsLen());
      noErr(await api.pushMetric(42));
      gte(out<number>(await api.metricsLen()), before + 1);
    },
  },
  {
    id: "metrics-get",
    name: "push + get at last index = pushed value",
    group: "CRDT Metrics",
    fn: async () => {
      noErr(await api.pushMetric(77));
      const len = out<number>(await api.metricsLen());
      eq(out<number>(await api.getMetric(len - 1)), 77);
    },
  },

  {
    id: "metrics-batch",
    name: "push three values → length increases by at least three",
    group: "CRDT Metrics",
    fn: async () => {
      const before = out<number>(await api.metricsLen());
      noErr(await api.pushMetric(10));
      noErr(await api.pushMetric(20));
      noErr(await api.pushMetric(30));
      gte(out<number>(await api.metricsLen()), before + 3);
    },
  },
  {
    id: "metrics-specific-value",
    name: "push specific value → get at last index returns it",
    group: "CRDT Metrics",
    fn: async () => {
      noErr(await api.pushMetric(13));
      const len = out<number>(await api.metricsLen());
      eq(out<number>(await api.getMetric(len - 1)), 13);
    },
  },

  {
    id: "tags-has",
    name: "add + has → true",
    group: "CRDT Tags",
    fn: async (r) => {
      noErr(await api.addTag(`t_${r}`, "mytag"));
      eq(out<boolean>(await api.hasTag(`t_${r}`, "mytag")), true);
    },
  },
  {
    id: "tags-missing",
    name: "has non-existent tag → false",
    group: "CRDT Tags",
    fn: async (r) => {
      eq(out<boolean>(await api.hasTag(`t_${r}`, "no-such-tag-xyzzy")), false);
    },
  },
  {
    id: "tags-count",
    name: "add + count >= 1",
    group: "CRDT Tags",
    fn: async (r) => {
      noErr(await api.addTag(`t2_${r}`, "counted"));
      gte(out<number>(await api.getTagCount(`t2_${r}`)), 1);
    },
  },

  {
    id: "tags-multiple-tags",
    name: "three tags on same key → count >= 3",
    group: "CRDT Tags",
    fn: async (r) => {
      noErr(await api.addTag(`tm_${r}`, "alpha"));
      noErr(await api.addTag(`tm_${r}`, "beta"));
      noErr(await api.addTag(`tm_${r}`, "gamma"));
      gte(out<number>(await api.getTagCount(`tm_${r}`)), 3);
    },
  },
  {
    id: "tags-different-keys",
    name: "tags on key A do not appear on key B",
    group: "CRDT Tags",
    fn: async (r) => {
      noErr(await api.addTag(`ta_${r}`, "only-on-a"));
      noErr(await api.addTag(`tb_${r}`, "unrelated")); // key must exist or has_tag errors
      eq(out<boolean>(await api.hasTag(`tb_${r}`, "only-on-a")), false);
    },
  },

  {
    id: "sorted-set-get",
    name: "sorted_set + sorted_get round-trip",
    group: "Sorted Collections",
    fn: async (r) => {
      noErr(await api.sortedSet(`s_${r}`, `v_${r}`));
      eq(out<string | null>(await api.sortedGet(`s_${r}`)), `v_${r}`);
    },
  },
  {
    id: "sorted-keys-ascending",
    name: "sorted_keys returns keys in ascending order",
    group: "Sorted Collections",
    fn: async (r) => {
      // Inserted out of order on purpose — the index, not the insertion order,
      // is what decides the listing.
      noErr(await api.sortedSet(`k_${r}_c`, "3"));
      noErr(await api.sortedSet(`k_${r}_a`, "1"));
      noErr(await api.sortedSet(`k_${r}_b`, "2"));
      const keys = out<string[]>(await api.sortedKeys());
      isArray(keys);
      const mine = keys.filter((k) => k.startsWith(`k_${r}_`));
      eq(mine.length, 3);
      eq(mine.join(","), [...mine].sort().join(","), "keys are ascending");
    },
  },
  {
    id: "sorted-range-half-open",
    name: "sorted_range is half-open: start in, end out",
    group: "Sorted Collections",
    fn: async (r) => {
      noErr(await api.sortedSet(`r_${r}_a`, "1"));
      noErr(await api.sortedSet(`r_${r}_b`, "2"));
      noErr(await api.sortedSet(`r_${r}_c`, "3"));
      const got = out<Record<string, string>>(await api.sortedRange(`r_${r}_a`, `r_${r}_c`));
      // `_a` and `_b`, never `_c`. Getting this wrong is the single most common
      // range bug, and an inclusive-end implementation passes every other
      // assertion in this group.
      eq(Object.keys(got).sort().join(","), [`r_${r}_a`, `r_${r}_b`].join(","));
    },
  },
  {
    id: "sorted-last-key",
    name: "sorted_last_key returns the largest key",
    group: "Sorted Collections",
    fn: async (r) => {
      noErr(await api.sortedSet(`zzz_${r}`, "last"));
      const keys = out<string[]>(await api.sortedKeys());
      const last = out<string | null>(await api.sortedLastKey());
      notEmpty(last, "sorted_last_key");
      const expected = [...keys].sort();
      eq(last, expected.length ? expected[expected.length - 1] : null);
    },
  },
  {
    id: "sorted-remove",
    name: "sorted_remove reports whether the key was there",
    group: "Sorted Collections",
    fn: async (r) => {
      noErr(await api.sortedSet(`rm_${r}`, "x"));
      eq(out<boolean>(await api.sortedRemove(`rm_${r}`)), true);
      eq(out<boolean>(await api.sortedRemove(`rm_${r}`)), false);
      eq(out<string | null>(await api.sortedGet(`rm_${r}`)), null);
    },
  },
  {
    id: "sorted-len",
    name: "sorted_len grows with an insert",
    group: "Sorted Collections",
    fn: async (r) => {
      const before = out<number>(await api.sortedLen());
      noErr(await api.sortedSet(`len_${r}`, "x"));
      eq(out<number>(await api.sortedLen()), before + 1);
    },
  },
  {
    id: "sorted-tag-add-idempotent",
    name: "sorted_tag_add returns true once, then false",
    group: "Sorted Collections",
    fn: async (r) => {
      eq(out<boolean>(await api.sortedTagAdd(`tag_${r}`)), true);
      eq(out<boolean>(await api.sortedTagAdd(`tag_${r}`)), false);
      eq(out<boolean>(await api.sortedTagContains(`tag_${r}`)), true);
    },
  },
  {
    id: "sorted-tag-readd-after-remove",
    name: "a removed element can be re-added and is present again",
    group: "Sorted Collections",
    fn: async (r) => {
      // Insert-after-remove on a set used to never converge across nodes
      // (fixed in rc.10). Single-node this only checks the tombstone is cleared
      // locally; the merobox scenario is what checks convergence.
      eq(out<boolean>(await api.sortedTagAdd(`re_${r}`)), true);
      eq(out<boolean>(await api.sortedTagRemove(`re_${r}`)), true);
      eq(out<boolean>(await api.sortedTagContains(`re_${r}`)), false);
      eq(out<boolean>(await api.sortedTagAdd(`re_${r}`)), true);
      eq(out<boolean>(await api.sortedTagContains(`re_${r}`)), true);
    },
  },
  {
    id: "sorted-tags-ascending",
    name: "sorted_tags_all returns elements in ascending order",
    group: "Sorted Collections",
    fn: async (r) => {
      noErr(await api.sortedTagAdd(`ord_${r}_c`));
      noErr(await api.sortedTagAdd(`ord_${r}_a`));
      noErr(await api.sortedTagAdd(`ord_${r}_b`));
      const all = out<string[]>(await api.sortedTagsAll());
      isArray(all);
      const mine = all.filter((t) => t.startsWith(`ord_${r}_`));
      eq(mine.join(","), [...mine].sort().join(","), "elements are ascending");
    },
  },
  {
    id: "sorted-tags-range",
    name: "sorted_tags_range is half-open too",
    group: "Sorted Collections",
    fn: async (r) => {
      noErr(await api.sortedTagAdd(`tr_${r}_a`));
      noErr(await api.sortedTagAdd(`tr_${r}_b`));
      noErr(await api.sortedTagAdd(`tr_${r}_c`));
      const got = out<string[]>(await api.sortedTagsRange(`tr_${r}_a`, `tr_${r}_c`));
      eq(got.join(","), [`tr_${r}_a`, `tr_${r}_b`].join(","));
    },
  },
  {
    id: "sorted-tags-last",
    name: "sorted_tags_last returns the largest element",
    group: "Sorted Collections",
    fn: async (r) => {
      noErr(await api.sortedTagAdd(`zzz_tag_${r}`));
      const all = [...out<string[]>(await api.sortedTagsAll())].sort();
      eq(
        out<string | null>(await api.sortedTagsLast()),
        all.length ? all[all.length - 1] : null,
      );
    },
  },

  {
    id: "shared-rotate-writers",
    name: "shared_rotate_writers keeps the caller able to write",
    group: "Shared Storage",
    fn: async (r) => {
      // A rotation REPLACES the set, so rotating to exactly [me] is the only
      // version of this that is safe to run against a shared node: any other
      // set could lock this context's cell against whoever set it up.
      const me = out<api.Identity>(await api.whoami());
      noErr(await api.sharedRotateWriters([me.account_id]));
      eq(out<boolean>(await api.sharedIsWriter(me.account_id)), true);
      noErr(await api.sharedSet(`rotated_${r}`));
      eq(out<string>(await api.sharedGet()), `rotated_${r}`);
    },
  },

  {
    id: "rga-title",
    name: "set_title + get_title round-trip",
    group: "RGA Document",
    fn: async (r) => {
      noErr(await api.rgaSetTitle(`doc_${r}`));
      eq(out<string>(await api.rgaGetTitle()), `doc_${r}`);
    },
  },
  {
    id: "rga-insert-get",
    name: "clear + insert_text + get_text",
    group: "RGA Document",
    fn: async (r) => {
      noErr(await api.rgaClear());
      noErr(await api.rgaInsertText(0, `hi_${r}`));
      contains(out<string>(await api.rgaGetText()), `hi_${r}`);
    },
  },
  {
    id: "rga-append",
    name: "append_text + get_text contains appended",
    group: "RGA Document",
    fn: async (r) => {
      noErr(await api.rgaClear());
      noErr(await api.rgaAppendText(`app_${r}`));
      contains(out<string>(await api.rgaGetText()), `app_${r}`);
    },
  },
  {
    id: "rga-length",
    name: "get_length matches text length",
    group: "RGA Document",
    fn: async (r) => {
      noErr(await api.rgaClear());
      noErr(await api.rgaAppendText(`len_${r}`));
      const text = out<string>(await api.rgaGetText());
      eq(out<number>(await api.rgaGetLength()), text.length);
    },
  },
  {
    id: "rga-is-empty",
    name: "is_empty → true after clear",
    group: "RGA Document",
    fn: async () => {
      noErr(await api.rgaClear());
      eq(out<boolean>(await api.rgaIsEmpty()), true);
    },
  },
  {
    id: "rga-delete",
    name: "delete_text shrinks length",
    group: "RGA Document",
    fn: async (r) => {
      noErr(await api.rgaClear());
      noErr(await api.rgaAppendText(`abcde_${r}`));
      const before = out<number>(await api.rgaGetLength());
      noErr(await api.rgaDeleteText(0, 2));
      const after = out<number>(await api.rgaGetLength());
      if (after >= before) throw new Error(`length should shrink: ${before} → ${after}`);
    },
  },

  {
    id: "rga-title-overwrite",
    name: "set_title twice → get_title returns second value",
    group: "RGA Document",
    fn: async (r) => {
      noErr(await api.rgaSetTitle(`first_${r}`));
      noErr(await api.rgaSetTitle(`second_${r}`));
      eq(out<string>(await api.rgaGetTitle()), `second_${r}`);
    },
  },
  {
    id: "rga-multiple-appends",
    name: "two appends → both strings present in get_text",
    group: "RGA Document",
    fn: async (r) => {
      noErr(await api.rgaClear());
      noErr(await api.rgaAppendText(`part1_${r}`));
      noErr(await api.rgaAppendText(`part2_${r}`));
      const text = out<string>(await api.rgaGetText());
      contains(text, `part1_${r}`);
      contains(text, `part2_${r}`);
    },
  },
  {
    id: "rga-insert-at-start",
    name: "insert at position 0 prepends to document",
    group: "RGA Document",
    fn: async (r) => {
      noErr(await api.rgaClear());
      noErr(await api.rgaAppendText(`suffix_${r}`));
      noErr(await api.rgaInsertText(0, "prefix_"));
      const text = out<string>(await api.rgaGetText());
      contains(text, "prefix_");
      contains(text, `suffix_${r}`);
    },
  },

  {
    id: "ws-get-info",
    name: "ws_get_info responds (initialized or not)",
    group: "Workspace",
    fn: async () => {
      const r = await api.wsGetInfo();
      const rr = r as { result?: unknown; error?: unknown };
      if (rr.error) {
        const msg = extractErrMsg(rr.error);
        if (!msg.toLowerCase().includes("not initialized")) throw new Error(msg);
      }
    },
  },
  {
    id: "ws-list-channels",
    name: "ws_list_channels returns array",
    group: "Workspace",
    fn: async () => {
      isArray(out<unknown[]>(await api.wsListChannels()));
    },
  },
  {
    id: "ws-list-groups",
    name: "ws_list_groups returns array",
    group: "Workspace",
    fn: async () => {
      isArray(out<unknown[]>(await api.wsListGroups()));
    },
  },
  {
    id: "ws-list-members",
    name: "ws_list_members returns array",
    group: "Workspace",
    fn: async () => {
      isArray(out<unknown[]>(await api.wsListMembers()));
    },
  },
  {
    id: "ws-init",
    name: "ws_init succeeds or is already initialized",
    group: "Workspace",
    fn: async () => {
      const res = await api.wsInit("E2E Workspace");
      const r = res as { error?: unknown };
      if (r?.error) {
        const msg = extractErrMsg(r.error);
        if (!msg.toLowerCase().includes("already initialized")) throw new Error(msg);
      }
    },
  },
  {
    id: "ws-channel-register",
    name: "register_channel + list → channel appears",
    group: "Workspace",
    fn: async (r) => {
      const ctxId = `ctx_${r}_fake`;
      noErr(await api.wsRegisterChannel(ctxId, `#chan_${r}`, "test topic"));
      const channels = out<api.ChannelRecord[]>(await api.wsListChannels());
      if (!channels.some((c) => c.context_id === ctxId))
        throw new Error("registered channel not found in list");
    },
  },
  {
    id: "ws-channel-unregister",
    name: "unregister_channel → channel removed from list",
    group: "Workspace",
    fn: async (r) => {
      const ctxId = `ctx_unreg_${r}`;
      noErr(await api.wsRegisterChannel(ctxId, `#tmp_${r}`, ""));
      noErr(await api.wsUnregisterChannel(ctxId));
      const channels = out<api.ChannelRecord[]>(await api.wsListChannels());
      if (channels.some((c) => c.context_id === ctxId))
        throw new Error("channel still in list after unregister");
    },
  },
  {
    id: "ws-group-register",
    name: "register_group + list → group appears",
    group: "Workspace",
    fn: async (r) => {
      const gId = `grp_${r}_fake`;
      noErr(await api.wsRegisterGroup(gId, `Group ${r}`, "desc"));
      const groups = out<api.WsGroupRecord[]>(await api.wsListGroups());
      if (!groups.some((g) => g.group_id === gId))
        throw new Error("registered group not found in list");
    },
  },
  {
    id: "ws-group-unregister",
    name: "unregister_group → group removed from list",
    group: "Workspace",
    fn: async (r) => {
      const gId = `grp_unreg_${r}`;
      noErr(await api.wsRegisterGroup(gId, `Tmp ${r}`, ""));
      noErr(await api.wsUnregisterGroup(gId));
      const groups = out<api.WsGroupRecord[]>(await api.wsListGroups());
      if (groups.some((g) => g.group_id === gId))
        throw new Error("group still in list after unregister");
    },
  },
  {
    id: "ws-my-role",
    name: "ws_my_role returns 'admin' after ws_init",
    group: "Workspace",
    fn: async () => {
      eq(out<string>(await api.wsMyRole()), "admin");
    },
  },
  {
    id: "ws-set-get-role",
    name: "set_member_role + get_member_role round-trip",
    group: "Workspace",
    fn: async (r) => {
      const fakeId = `fakemember_${r}`;
      noErr(await api.wsSetMemberRole(fakeId, "member"));
      eq(out<string>(await api.wsGetMemberRole(fakeId)), "member");
    },
  },
  {
    id: "ws-list-members-count",
    name: "list_members has at least 1 entry after init (the admin)",
    group: "Workspace",
    fn: async () => {
      const members = out<api.MemberRecord[]>(await api.wsListMembers());
      isArray(members);
      gte(members.length, 1);
    },
  },

  {
    id: "amap-insert-get",
    name: "authored_insert + authored_get round-trip",
    group: "Authored Map",
    fn: async (r) => {
      noErr(await api.authoredInsert(`am_${r}`, `amv_${r}`));
      eq(out<string | null>(await api.authoredGet(`am_${r}`)), `amv_${r}`);
    },
  },
  {
    id: "amap-update",
    name: "authored_update changes the value (owner-only)",
    group: "Authored Map",
    fn: async (r) => {
      noErr(await api.authoredInsert(`amu_${r}`, "first"));
      noErr(await api.authoredUpdate(`amu_${r}`, "second"));
      eq(out<string | null>(await api.authoredGet(`amu_${r}`)), "second");
    },
  },
  {
    id: "amap-remove",
    name: "authored_remove deletes the entry",
    group: "Authored Map",
    fn: async (r) => {
      noErr(await api.authoredInsert(`amr_${r}`, "todel"));
      noErr(await api.authoredRemove(`amr_${r}`));
      eq(outOrNull<string>(await api.authoredGet(`amr_${r}`)), null);
    },
  },
  {
    id: "amap-get-missing",
    name: "authored_get on unknown key → null",
    group: "Authored Map",
    fn: async (r) => {
      eq(outOrNull<string>(await api.authoredGet(`am_no_such_${r}`)), null);
    },
  },
  {
    id: "amap-entries",
    name: "authored_entries contains inserted key",
    group: "Authored Map",
    fn: async (r) => {
      noErr(await api.authoredInsert(`ame_${r}`, "v"));
      const map = out<Record<string, string>>(await api.authoredEntries());
      if (!(`ame_${r}` in map)) throw new Error("inserted key missing from entries");
    },
  },
  {
    id: "amap-len",
    name: "authored_len increases after insert",
    group: "Authored Map",
    fn: async (r) => {
      const before = out<number>(await api.authoredLen());
      noErr(await api.authoredInsert(`aml_${r}`, "v"));
      gte(out<number>(await api.authoredLen()), before + 1);
    },
  },
  {
    id: "amap-get-owner",
    name: "authored_get_owner returns non-empty owner key",
    group: "Authored Map",
    fn: async (r) => {
      noErr(await api.authoredInsert(`amo_${r}`, "v"));
      const owner = out<string | null>(await api.authoredGetOwner(`amo_${r}`));
      notEmpty(owner ?? "", "owner key should be a non-empty base58 string");
    },
  },
  {
    id: "amap-duplicate-insert",
    name: "duplicate authored_insert on same key → error",
    group: "Authored Map",
    fn: async (r) => {
      noErr(await api.authoredInsert(`amd_${r}`, "first"));
      expectErr(await api.authoredInsert(`amd_${r}`, "second"));
    },
  },

  {
    id: "shared-set-get",
    name: "shared_set + shared_get round-trip",
    group: "Shared Storage",
    fn: async (r) => {
      noErr(await api.sharedSet(`sv_${r}`));
      eq(out<string>(await api.sharedGet()), `sv_${r}`);
    },
  },
  {
    id: "shared-overwrite",
    name: "shared_set twice → shared_get returns latest",
    group: "Shared Storage",
    fn: async (r) => {
      noErr(await api.sharedSet(`first_${r}`));
      noErr(await api.sharedSet(`second_${r}`));
      eq(out<string>(await api.sharedGet()), `second_${r}`);
    },
  },
  {
    id: "shared-writers-array",
    name: "shared_get_writers returns a non-empty array",
    group: "Shared Storage",
    fn: async () => {
      const writers = out<string[]>(await api.sharedGetWriters());
      isArray(writers);
      gte(writers.length, 1);
    },
  },
  {
    id: "shared-is-writer-self",
    name: "shared_is_writer for our own account → true (after a successful set)",
    group: "Shared Storage",
    fn: async (r) => {
      // Our ACCOUNT id, not getContextIdentity(): core 0.11 keys the writer
      // set by account, and the device key names an account nobody holds.
      const me = out<api.Identity>(await api.whoami()).account_id;
      noErr(await api.sharedSet(`iw_${r}`));
      eq(out<boolean>(await api.sharedIsWriter(me)), true);
    },
  },
  {
    id: "shared-is-writer-unknown",
    name: "shared_is_writer for unknown account → false",
    group: "Shared Storage",
    fn: async () => {
      // A well-formed account id (64 hex chars) that nobody holds — a
      // malformed one would be rejected as a parse error, testing nothing.
      eq(out<boolean>(await api.sharedIsWriter("00".repeat(32))), false);
    },
  },
  {
    id: "shared-is-frozen",
    name: "shared_is_frozen returns boolean (false at runtime)",
    group: "Shared Storage",
    fn: async () => {
      eq(out<boolean>(await api.sharedIsFrozen()), false);
    },
  },
];

export const TOTAL_TESTS = TESTS.length;


const GROUP_ORDER = [
  "KV Operations",
  "KV Handlers",
  "User Storage",
  "Frozen Storage",
  "Private Storage",
  "Blob Storage",
  "CRDT Counters",
  "CRDT Registers",
  "CRDT Metadata",
  "CRDT Metrics",
  "CRDT Tags",
  "Sorted Collections",
  "RGA Document",
  "Authored Map",
  "Shared Storage",
  "Workspace",
];

const C = {
  card: "var(--color-bg-card)",
  surface: "var(--color-bg-input)",
  border: "var(--color-border)",
  text: "var(--color-text-primary)",
  muted: "var(--color-text-muted)",
  brand: "var(--color-brand-600)",
  success: "var(--color-success)",
  error: "var(--color-error)",
  warning: "var(--color-warning)",
};

interface TestResult {
  id: string;
  status: Status;
  error?: string;
  ms?: number;
}

function StatusDot({ status }: { status: Status }) {
  const cfg: Record<Status, { color: string; char: string }> = {
    idle: { color: C.muted, char: "○" },
    running: { color: C.warning, char: "◌" },
    pass: { color: C.success, char: "●" },
    fail: { color: C.error, char: "●" },
  };
  const { color, char } = cfg[status];
  return <span style={{ color, fontFamily: "monospace", fontSize: 14, flexShrink: 0 }}>{char}</span>;
}

function Summary({
  results, running, onRun, onReset,
}: {
  results: Map<string, TestResult>;
  running: boolean;
  onRun: () => void;
  onReset: () => void;
}) {
  const vals = [...results.values()];
  const passed = vals.filter((r) => r.status === "pass").length;
  const failed = vals.filter((r) => r.status === "fail").length;
  const done = passed + failed;
  const allDone = done === TOTAL_TESTS;

  return (
    <div className="method-card" style={{ display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap" as const, marginBottom: 16 }} data-testid="test-summary">
      <div style={{ flex: 1, minWidth: 200 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.brand, fontFamily: "'Courier New', monospace", paddingBottom: 10, borderBottom: `1px solid ${C.border}`, marginBottom: 12 }}>
          Test Runner — {TOTAL_TESTS} tests
        </div>
        <div style={{ display: "flex", gap: 20, fontSize: 13, flexWrap: "wrap" as const }}>
          <span style={{ color: C.success }}>passed <strong>{passed}</strong></span>
          <span style={{ color: failed > 0 ? C.error : C.muted }}>failed <strong>{failed}</strong></span>
          <span style={{ color: C.muted }}>total <strong>{TOTAL_TESTS}</strong></span>
          {running && <span style={{ color: C.warning }}>{done}/{TOTAL_TESTS} running…</span>}
          {allDone && !running && (
            <span style={{ color: failed === 0 ? C.success : C.error, fontWeight: 700 }}>
              {failed === 0 ? "✓ all passed" : `✗ ${failed} failed`}
            </span>
          )}
        </div>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn-calimero" onClick={onRun} disabled={running} data-testid="btn-run-all">
          {running ? "Running…" : "Run All Tests"}
        </button>
        <button className="btn-calimero-outline" onClick={onReset} disabled={running}>Reset</button>
      </div>
    </div>
  );
}

function TestGroup({ group, tests, results, running, onRunGroup }: {
  group: string;
  tests: TestCase[];
  results: Map<string, TestResult>;
  running: boolean;
  onRunGroup: (g: string) => void;
}) {
  const statuses = tests.map((t) => results.get(t.id)?.status ?? "idle");
  const passed = statuses.filter((s) => s === "pass").length;
  const failed = statuses.filter((s) => s === "fail").length;
  const groupId = group.replace(/\s+/g, "-").toLowerCase();

  return (
    <div className="method-card" style={{ marginBottom: 10, padding: "14px 18px" }} data-testid={`group-${groupId}`}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingBottom: 10, marginBottom: 12, borderBottom: `1px solid ${C.border}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: C.brand, fontFamily: "'Courier New', monospace" }}>{group}</span>
          <span style={{ fontSize: 11, color: C.muted }}>
            {passed}/{tests.length}
            {failed > 0 && <span style={{ color: C.error }}> · {failed} ✗</span>}
          </span>
        </div>
        <button className="btn-calimero-outline" style={{ fontSize: 11, padding: "3px 10px" }} onClick={() => onRunGroup(group)} disabled={running}>
          Run
        </button>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {tests.map((t) => {
          const result = results.get(t.id);
          const status = result?.status ?? "idle";
          return (
            <div key={t.id} data-testid={`test-${t.id}`} data-status={status}
              style={{
                display: "flex", alignItems: "flex-start", gap: 10,
                padding: "5px 8px", borderRadius: 5,
                background: status === "fail" ? "rgba(239,68,68,0.06)" : status === "pass" ? "rgba(22,163,74,0.04)" : "transparent",
              }}
            >
              <StatusDot status={status} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <span style={{ fontSize: 12, color: status === "fail" ? C.error : C.text }}>{t.name}</span>
                {result?.ms !== undefined && status === "pass" && (
                  <span style={{ fontSize: 10, color: C.muted, marginLeft: 8 }}>{result.ms}ms</span>
                )}
                {result?.error && (
                  <div style={{ marginTop: 4, fontSize: 11, color: C.error, fontFamily: "'Courier New', monospace", background: "rgba(239,68,68,0.08)", borderRadius: 4, padding: "4px 8px", wordBreak: "break-all" as const }}>
                    {result.error}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function TestRunner() {
  const [results, setResults] = useState<Map<string, TestResult>>(new Map());
  const [running, setRunning] = useState(false);

  function update(id: string, patch: Partial<TestResult>) {
    setResults((prev) => {
      const next = new Map(prev);
      next.set(id, { id, status: "idle", ...prev.get(id), ...patch });
      return next;
    });
  }

  const runTests = useCallback(async (tests: TestCase[]) => {
    if (running) return;
    setRunning(true);
    const runId = `e2e_${Date.now().toString(36)}`;
    for (const test of tests) {
      update(test.id, { status: "running", error: undefined, ms: undefined });
      const t0 = performance.now();
      try {
        await test.fn(runId);
        update(test.id, { status: "pass", ms: Math.round(performance.now() - t0) });
      } catch (err) {
        update(test.id, { status: "fail", ms: Math.round(performance.now() - t0), error: err instanceof Error ? err.message : String(err) });
      }
    }
    setRunning(false);
  }, [running]);

  const grouped = GROUP_ORDER
    .map((g) => ({ group: g, tests: TESTS.filter((t) => t.group === g) }))
    .filter((g) => g.tests.length > 0);

  return (
    <div>
      <div className="section-header">
        <h2 className="section-title">Test Runner</h2>
        <p className="section-desc">
          {TOTAL_TESTS} tests across all sections — runs against the live context. Green = everything works.
        </p>
      </div>

      <Summary results={results} running={running} onRun={() => runTests(TESTS)} onReset={() => setResults(new Map())} />

      {grouped.map(({ group, tests }) => (
        <TestGroup key={group} group={group} tests={tests} results={results} running={running} onRunGroup={(g) => runTests(TESTS.filter((t) => t.group === g))} />
      ))}
    </div>
  );
}
