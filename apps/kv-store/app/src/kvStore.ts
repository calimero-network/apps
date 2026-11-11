import { type ClientRoutes } from "@calimero-apps/connect";

/** The package a production instance is created from (`[package.metadata.calimero]`). */
export const PACKAGE = "com.calimero.kv-store";

/**
 * The contract's methods by their ABI names (camelCase), split the way the node
 * runs them: a call goes through the app's log (`POST /apps/{app}/intents`), a
 * view is answered by a node without writing (`/views`). `kvStore.test.ts`
 * asserts these lists are exactly the committed `logic/res/abi.json`'s, so a
 * method the contract drops or renames fails a test rather than a request.
 */
export const CALLS = ["set", "updateIfExists", "getOrInsert", "remove", "clear"] as const;
export const VIEWS = ["entries", "len", "get", "getUnchecked", "getResult"] as const;

/** The store, typed from the contract (no client is generated from a component ABI yet). */
export interface KvStore {
  set(key: string, value: string): Promise<null>;
  /** `false` when the key is absent: nothing is inserted. */
  updateIfExists(key: string, value: string): Promise<boolean>;
  /** The EXISTING value when there is one, else `value` (stored). */
  getOrInsert(key: string, value: string): Promise<string>;
  /** At most the first 1,000 keys, in key order. */
  entries(): Promise<Record<string, string>>;
  /** A u64: a decimal string on the wire (`"0"`). */
  len(): Promise<string>;
  get(key: string): Promise<string | null>;
  /** Panics on an absent key: the node answers `422 TRAP` and nothing commits. */
  getUnchecked(key: string): Promise<string>;
  /** `AppError` `NotFound { key }` on an absent key. */
  getResult(key: string): Promise<string>;
  remove(key: string): Promise<string | null>;
  clear(): Promise<null>;
}

type Transport = ClientRoutes<{ apps: "call" | "view" }>;

/**
 * The store at instance `app` through `client`. `after` runs after every request
 * (the session store syncs a refreshed session there).
 */
export function kvStore(client: Transport, app: string, after: () => void = () => {}): KvStore {
  const call = async <T>(method: (typeof CALLS)[number], args: Record<string, string> = {}): Promise<T> => {
    try {
      return (await client.apps.call({ app, method, args })).result as T;
    } finally {
      after();
    }
  };
  const view = async <T>(method: (typeof VIEWS)[number], args: Record<string, string> = {}): Promise<T> => {
    try {
      return (await client.apps.view({ app, method, args })).result as T;
    } finally {
      after();
    }
  };
  return {
    set: (key, value) => call("set", { key, value }),
    updateIfExists: (key, value) => call("updateIfExists", { key, value }),
    getOrInsert: (key, value) => call("getOrInsert", { key, value }),
    remove: (key) => call("remove", { key }),
    clear: () => call("clear"),
    entries: () => view("entries"),
    len: () => view("len"),
    get: (key) => view("get", { key }),
    getUnchecked: (key) => view("getUnchecked", { key }),
    getResult: (key) => view("getResult", { key }),
  };
}
