import { passkeyConfirm, type CallResult, type PasskeyProvider } from "@calimero-network/mero-js";
import { type ClientRoutes } from "@calimero-apps/connect";

/** The package the matrix packs its own releases under, with a per-run suffix (`mpk.ts`). */
export const PACKAGE = "com.calimero.conformance";

/**
 * The contract's methods by their ABI names (camelCase), split the way the
 * node runs them: a call goes through the app's log (`POST /apps/{app}/intents`),
 * a view is answered without writing (`/views`). `contract.test.ts` asserts these
 * are exactly the committed `logic/res/abi.json`'s, with its parameter names.
 */
export const CALLS = [
  "set",
  "confirmedSet",
  "remove",
  "setUserSimple",
  "addFrozen",
  "authoredInsert",
  "authoredUpdate",
  "authoredRemove",
  "authoredVecPush",
  "authoredVecUpdate",
  "sharedSet",
  "sharedAddWriter",
] as const;
export const VIEWS = [
  "get",
  "publicGet",
  "getResult",
  "getUnchecked",
  "len",
  "myAccount",
  "getUserSimple",
  "getUserSimpleFor",
  "getFrozen",
  "authoredGet",
  "authoredGetOwner",
  "authoredVecGet",
  "authoredVecGetOwner",
  "authoredVecLen",
  "sharedGet",
  "sharedGetWriters",
] as const;

export type CallName = (typeof CALLS)[number];
export type ViewName = (typeof VIEWS)[number];

/**
 * The contract at one app instance, typed. The one place the matrix turns the
 * node's answers into the shapes it compares: `u64` results (`len`,
 * `authoredVecPush`, `authoredVecLen`) arrive as decimal strings and become
 * numbers here; a vector index goes out as a decimal string.
 */
export interface Contract {
  set(key: string, value: string): Promise<CallResult>;
  /** Needs the caller's passkey: without one the node answers `412 CONFIRM_REQUIRED`. */
  confirmedSet(key: string, value: string, passkey?: PasskeyProvider): Promise<CallResult>;
  remove(key: string): Promise<string | null>;
  setUserSimple(value: string): Promise<null>;
  addFrozen(value: string): Promise<string>;
  authoredInsert(key: string, value: string): Promise<null>;
  authoredUpdate(key: string, value: string): Promise<null>;
  authoredRemove(key: string): Promise<string | null>;
  authoredVecPush(value: string): Promise<number>;
  authoredVecUpdate(index: number, value: string): Promise<null>;
  sharedSet(value: string): Promise<null>;
  sharedAddWriter(account: string): Promise<null>;

  get(key: string): Promise<string | null>;
  publicGet(key: string): Promise<string | null>;
  getResult(key: string): Promise<string>;
  getUnchecked(key: string): Promise<string>;
  len(): Promise<number>;
  myAccount(): Promise<string>;
  getUserSimple(): Promise<string | null>;
  getUserSimpleFor(account: string): Promise<string | null>;
  getFrozen(hashHex: string): Promise<string>;
  authoredGet(key: string): Promise<string | null>;
  authoredGetOwner(key: string): Promise<string | null>;
  authoredVecGet(index: number): Promise<string | null>;
  authoredVecGetOwner(index: number): Promise<string | null>;
  authoredVecLen(): Promise<number>;
  sharedGet(): Promise<string | null>;
  sharedGetWriters(): Promise<string[]>;
}

type Transport = ClientRoutes<{ apps: "call" | "view" }>;

/** A `u64` result: a decimal string on the wire. */
function u64(value: unknown): number {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new Error(`expected a u64 as a decimal string, got ${JSON.stringify(value)}`);
  }
  return Number(value);
}

/** The contract at instance `app` through `client`. */
export function contract(client: Transport, app: string): Contract {
  const call = async <T>(method: CallName, args: Record<string, string> = {}): Promise<T> =>
    (await client.apps.call({ app, method, args })).result as T;
  const view = async <T>(method: ViewName, args: Record<string, string> = {}): Promise<T> =>
    (await client.apps.view({ app, method, args })).result as T;
  return {
    set: (key, value) => client.apps.call({ app, method: "set", args: { key, value } }),
    confirmedSet: (key, value, passkey) =>
      passkey
        ? client.apps.call({ app, method: "confirmedSet", args: { key, value } }, { confirm: passkeyConfirm(passkey) })
        : client.apps.call({ app, method: "confirmedSet", args: { key, value } }),
    remove: (key) => call("remove", { key }),
    setUserSimple: (value) => call("setUserSimple", { value }),
    addFrozen: (value) => call("addFrozen", { value }),
    authoredInsert: (key, value) => call("authoredInsert", { key, value }),
    authoredUpdate: (key, value) => call("authoredUpdate", { key, value }),
    authoredRemove: (key) => call("authoredRemove", { key }),
    authoredVecPush: async (value) => u64(await call("authoredVecPush", { value })),
    authoredVecUpdate: (index, value) => call("authoredVecUpdate", { index: String(index), value }),
    sharedSet: (value) => call("sharedSet", { value }),
    sharedAddWriter: (account) => call("sharedAddWriter", { account }),

    get: (key) => view("get", { key }),
    publicGet: (key) => view("publicGet", { key }),
    getResult: (key) => view("getResult", { key }),
    getUnchecked: (key) => view("getUnchecked", { key }),
    len: async () => u64(await view("len")),
    myAccount: () => view("myAccount"),
    getUserSimple: () => view("getUserSimple"),
    getUserSimpleFor: (account) => view("getUserSimpleFor", { account }),
    getFrozen: (hashHex) => view("getFrozen", { hashHex }),
    authoredGet: (key) => view("authoredGet", { key }),
    authoredGetOwner: (key) => view("authoredGetOwner", { key }),
    authoredVecGet: (index) => view("authoredVecGet", { index: String(index) }),
    authoredVecGetOwner: (index) => view("authoredVecGetOwner", { index: String(index) }),
    authoredVecLen: async () => u64(await view("authoredVecLen")),
    sharedGet: () => view("sharedGet"),
    sharedGetWriters: () => view("sharedGetWriters"),
  };
}
