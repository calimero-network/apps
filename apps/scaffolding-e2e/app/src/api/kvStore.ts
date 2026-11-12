import { int, run, snake, u64 } from "./rpc";

// What every section calls: one function per contract method, each calling
// `ScaffoldingE2eClient` (the generated client, `src/generated/client.ts`) with
// the ABI's argument names and 64-bit integers as decimal strings (`u64`). The
// answers keep v1's shapes: a `u64`/`i64` result is a number again (`int`), and
// the few RECORD results are mapped back with `v1Record`, so the screens read
// `file.uploaded_at` (a number) as before although the wire says
// `uploadedAt: "1730000000000"`.
//
// Every section displays what came back, so these return the envelope
// (`{ result: { output } }` or `{ error }`) rather than a bare value — that is
// what `ResultBox` renders and what the Test Runner asserts on.

/** Record fields that are 64-bit integers, decimal strings on the wire. */
const INT_FIELDS = new Set(["size", "uploaded_at", "registered_at", "channel_count", "group_count", "member_count"]);

/** One record from the wire: camelCase keys to snake_case, integer fields to numbers. */
export function v1Record(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(v1Record);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([k, v]) => {
      const key = snake(k);
      return [key, INT_FIELDS.has(key) && typeof v === "string" ? Number(v) : v];
    }),
  );
}

/**
 * The caller's identity — see the contract's `whoami`. 1.0 runs a method for
 * the account, so `device_id` is the account too (an API key's id for an
 * API-key caller).
 */
export interface Identity {
  device_id: string;
  /** The account: what every writer set, owner and role is keyed by. */
  account_id: string;
}

export const whoami = () =>
  run<Identity>("whoami", (c) => c.whoami(), v1Record);

/**
 * The caller's account on its own.
 *
 * `whoami().account_id` is the same value and is what the rest of this UI uses.
 * This method exists only so the account accessor is spelled the same here as
 * in core's copy of this scaffold, which is what keeps a scenario
 * portable between the two. It is exposed in the frontend so the contract-call
 * check sees a caller for it, and so the Test Runner can assert the two names
 * never start disagreeing.
 */
export const myAccount = () =>
  run<string>("my_account", (c) => c.myAccount());

/**
 * Drives the SDK's host-backed `tracing` subscriber.
 *
 * ⚠️ The response tells you almost nothing, by design of the RPC layer rather
 * than of this method. The node writes the execution outcome's log lines to ITS
 * OWN log (`crates/server/src/execute.rs`) and returns only the value, so there
 * is no `logs` field on the reply for this — or any — client to read. `output`
 * is null and that is all there is.
 *
 * To see the lines: grep the node's log for `execution log`. The level
 * filtering is asserted in `workflows/host-logging.yml`, where a container log
 * IS available.
 *
 * `debug: true` raises the level to DEBUG first. The default is WARN, so
 * without it the info and debug lines are filtered out inside the guest and
 * never reach the outcome at all.
 */
export const tracingProbe = (debug: boolean) =>
  run<null>("tracing_probe", (c) => c.tracingProbe({ debug }));

export const kvSet = (key: string, value: string) =>
  run("set", (c) => c.set({ key, value }));

export const kvSetWithHandler = (key: string, value: string) =>
  run("set_with_handler", (c) => c.setWithHandler({ key, value }));

export const kvGet = (key: string) =>
  run<string | null>("get", (c) => c.get({ key }));

export const kvGetResult = (key: string) =>
  run<string>("get_result", (c) => c.getResult({ key }));

export const kvEntries = () =>
  run<Record<string, string>>("entries", (c) => c.entries());

export const kvLen = () => run<number>("len", (c) => c.len(), int);

export const kvRemove = (key: string) =>
  run<string | null>("remove", (c) => c.remove({ key }));

export const kvRemoveWithHandler = (key: string) =>
  run<string | null>("remove_with_handler", (c) => c.removeWithHandler({ key }));

export const kvClear = () => run<void>("clear", (c) => c.clear());

export const kvClearWithHandler = () =>
  run<void>("clear_with_handler", (c) => c.clearWithHandler());

export const insertHandler = (key: string, value: string) =>
  run("insert_handler", (c) => c.insertHandler({ key, value }));

export const updateHandler = (key: string, value: string) =>
  run("update_handler", (c) => c.updateHandler({ key, value }));

export const removeHandler = (key: string) =>
  run<void>("remove_handler", (c) => c.removeHandler({ key }));

export const clearHandler = () =>
  run<void>("clear_handler", (c) => c.clearHandler());

export const getHandlerExecutionCount = () =>
  run<number>("get_handler_execution_count", (c) => c.getHandlerExecutionCount(), int);

export const setUserSimple = (value: string) =>
  run("set_user_simple", (c) => c.setUserSimple({ value }));

export const getUserSimple = () =>
  run<string | null>("get_user_simple", (c) => c.getUserSimple());

/**
 * Read another user's `UserStorage` slot, addressed by ACCOUNT (64 hex).
 *
 * Not the DEVICE key: rc.21 rekeyed `UserStorage` by account, so a
 * device key names a slot nobody writes to and this answers `null` forever
 * instead of erroring. Get the value from `whoami().account_id`.
 */
export const getUserSimpleFor = (account_hex: string) =>
  run<string | null>("get_user_simple_for", (c) => c.getUserSimpleFor({
    accountHex: account_hex,
  }));

export const setUserNested = (key: string, value: string) =>
  run("set_user_nested", (c) => c.setUserNested({ key, value }));

export const getUserNested = (key: string) =>
  run<string | null>("get_user_nested", (c) => c.getUserNested({ key }));

export const addFrozen = (value: string) =>
  run<string>("add_frozen", (c) => c.addFrozen({ value }));

export const getFrozen = (hash_hex: string) =>
  run<string>("get_frozen", (c) => c.getFrozen({ hashHex: hash_hex }));

export const addSecret = (game_id: string, secret: string) =>
  run("add_secret", (c) => c.addSecret({ gameId: game_id, secret }));

export const addGuess = (game_id: string, guess: string) =>
  run<boolean>("add_guess", (c) => c.addGuess({
    gameId: game_id,
    guess,
  }));

export const mySecrets = () =>
  run<Record<string, string>>("my_secrets", (c) => c.mySecrets());

export const games = () =>
  run<Record<string, string>>("games", (c) => c.games());

export interface FileRecord {
  id: string;
  name: string;
  blob_id: string;
  size: number;
  mime_type: string;
  uploaded_by: string;
  uploaded_at: number;
}

export const uploadFile = (
  name: string,
  blob_id_str: string,
  size: number,
  mime_type: string,
) => run<string>("upload_file", (c) => c.uploadFile({ name, blobIdStr: blob_id_str, size: u64(size), mimeType: mime_type }));

export const deleteFile = (file_id: string) =>
  run<void>("delete_file", (c) => c.deleteFile({ fileId: file_id }));

export const listFiles = () =>
  run<FileRecord[]>("list_files", (c) => c.listFiles(), v1Record);

export const getFile = (file_id: string) =>
  run<FileRecord>("get_file", (c) => c.getFile({ fileId: file_id }), v1Record);

// A BlobId has been 64 hex characters since rc.27. The contract method was
// already `get_blob_id_hex`; only this client-side name still said base58, and
// a name that lies about an encoding is exactly how mero-sign shipped a
// base58-encoded blob id into a contract (apps#143).
export const getBlobIdHex = (file_id: string) =>
  run<string>("get_blob_id_hex", (c) => c.getBlobIdHex({ fileId: file_id }));

export const searchFiles = (query: string) =>
  run<FileRecord[]>("search_files", (c) => c.searchFiles({ query }), v1Record);

export const incrementGCounter = (key: string) =>
  run<number>("increment_g_counter", (c) => c.incrementGCounter({ key }), int);

export const getGCounter = (key: string) =>
  run<number>("get_g_counter", (c) => c.getGCounter({ key }), int);

/** v1's alias of `incrementGCounter`, kept in the contract. */
export const incrementCounter = (key: string) =>
  run<number>("increment_counter", (c) => c.incrementCounter({ key }), int);

/** v1's alias of `getGCounter`. */
export const getCounter = (key: string) =>
  run<number>("get_counter", (c) => c.getCounter({ key }), int);

export const incrementPnCounter = (key: string) =>
  run<number>("increment_pn_counter", (c) => c.incrementPnCounter({ key }), int);

export const decrementPnCounter = (key: string) =>
  run<number>("decrement_pn_counter", (c) => c.decrementPnCounter({ key }), int);

export const getPnCounter = (key: string) =>
  run<number>("get_pn_counter", (c) => c.getPnCounter({ key }), int);

export const setRegister = (key: string, value: string) =>
  run("set_register", (c) => c.setRegister({ key, value }));

export const getRegister = (key: string) =>
  run<string>("get_register", (c) => c.getRegister({ key }));

export const setMetadata = (
  outer_key: string,
  inner_key: string,
  value: string,
) => run("set_metadata", (c) => c.setMetadata({ outerKey: outer_key, innerKey: inner_key, value }));

export const getMetadata = (outer_key: string, inner_key: string) =>
  run<string>("get_metadata", (c) => c.getMetadata({
    outerKey: outer_key,
    innerKey: inner_key,
  }));

export const pushMetric = (value: number) =>
  run<number>("push_metric", (c) => c.pushMetric({ value: u64(value) }), int);

export const getMetric = (index: number) =>
  run<number>("get_metric", (c) => c.getMetric({ index: u64(index) }), int);

export const metricsLen = () =>
  run<number>("metrics_len", (c) => c.metricsLen(), int);

export const addTag = (key: string, tag: string) =>
  run("add_tag", (c) => c.addTag({ key, tag }));

export const hasTag = (key: string, tag: string) =>
  run<boolean>("has_tag", (c) => c.hasTag({ key, tag }));

export const getTagCount = (key: string) =>
  run<number>("get_tag_count", (c) => c.getTagCount({ key }), int);

// ── Sorted collections ───────────────────────────────────────────────────────
//
// `SortedMap`/`SortedSet` are not sorted flavours of the unordered pair above:
// only these maintain the WASM host's ORDERED INDEX, which is what makes a range
// query or "the largest key" a seek instead of a full scan. Ranges are half-open
// — `[start, end)`, like every Rust range — so `end` is never returned.

export const sortedSet = (key: string, value: string) =>
  run("sorted_set", (c) => c.sortedSet({ key, value }));

export const sortedGet = (key: string) =>
  run<string | null>("sorted_get", (c) => c.sortedGet({ key }));

export const sortedKeys = () =>
  run<string[]>("sorted_keys", (c) => c.sortedKeys());

export const sortedRange = (start: string, end: string) =>
  run<Record<string, string>>("sorted_range", (c) => c.sortedRange({
    start,
    end,
  }));

export const sortedLastKey = () =>
  run<string | null>("sorted_last_key", (c) => c.sortedLastKey());

export const sortedRemove = (key: string) =>
  run<boolean>("sorted_remove", (c) => c.sortedRemove({ key }));

export const sortedLen = () =>
  run<number>("sorted_len", (c) => c.sortedLen(), int);

export const sortedTagAdd = (tag: string) =>
  run<boolean>("sorted_tag_add", (c) => c.sortedTagAdd({ tag }));

export const sortedTagRemove = (tag: string) =>
  run<boolean>("sorted_tag_remove", (c) => c.sortedTagRemove({ tag }));

export const sortedTagContains = (tag: string) =>
  run<boolean>("sorted_tag_contains", (c) => c.sortedTagContains({ tag }));

export const sortedTagsAll = () =>
  run<string[]>("sorted_tags_all", (c) => c.sortedTagsAll());

export const sortedTagsRange = (start: string, end: string) =>
  run<string[]>("sorted_tags_range", (c) => c.sortedTagsRange({
    start,
    end,
  }));

export const sortedTagsLast = () =>
  run<string | null>("sorted_tags_last", (c) => c.sortedTagsLast());

export const rgaInsertText = (position: number, text: string) =>
  run("rga_insert_text", (c) => c.rgaInsertText({ position: u64(position), text }));

export const rgaDeleteText = (start: number, end: number) =>
  run("rga_delete_text", (c) => c.rgaDeleteText({ start: u64(start), end: u64(end) }));

export const rgaGetText = () =>
  run<string>("rga_get_text", (c) => c.rgaGetText());

export const rgaGetLength = () =>
  run<number>("rga_get_length", (c) => c.rgaGetLength(), int);

export const rgaIsEmpty = () =>
  run<boolean>("rga_is_empty", (c) => c.rgaIsEmpty());

export const rgaSetTitle = (new_title: string) =>
  run("rga_set_title", (c) => c.rgaSetTitle({ newTitle: new_title }));

export const rgaGetTitle = () =>
  run<string>("rga_get_title", (c) => c.rgaGetTitle());

export const rgaAppendText = (text: string) =>
  run("rga_append_text", (c) => c.rgaAppendText({ text }));

export const rgaClear = () =>
  run<void>("rga_clear", (c) => c.rgaClear());


export interface ChannelRecord {
  context_id: string;
  name: string;
  topic: string;
  /** The ACCOUNT that registered it, 64 hex — not a device key. */
  created_by: string;
  /**
   * `env::time_now()` at registration. Exists so the record can be an atomic
   * LWW leaf: two members registering the same context id concurrently
   * converge on the later write instead of on a mixture of the two.
   */
  registered_at: number;
}

export interface WsGroupRecord {
  group_id: string;
  name: string;
  description: string;
  created_by: string;
  registered_at: number;
}

export interface WorkspaceInfo {
  name: string;
  admin: string;
  channel_count: number;
  group_count: number;
  member_count: number;
}

export interface MemberRecord {
  identity: string;
  role: string;
}

export const wsInit = (name: string) =>
  run<void>("ws_init", (c) => c.wsInit({ name }));

export const wsGetInfo = () =>
  run<WorkspaceInfo>("ws_get_info", (c) => c.wsGetInfo(), v1Record);

export const wsRegisterChannel = (context_id: string, name: string, topic: string) =>
  run<void>("ws_register_channel", (c) => c.wsRegisterChannel({ contextId: context_id, name, topic }));

export const wsUnregisterChannel = (context_id: string) =>
  run<void>("ws_unregister_channel", (c) => c.wsUnregisterChannel({ contextId: context_id }));

export const wsListChannels = () =>
  run<ChannelRecord[]>("ws_list_channels", (c) => c.wsListChannels(), v1Record);

export const wsRegisterGroup = (group_id: string, name: string, description: string) =>
  run<void>("ws_register_group", (c) => c.wsRegisterGroup({ groupId: group_id, name, description }));

export const wsUnregisterGroup = (group_id: string) =>
  run<void>("ws_unregister_group", (c) => c.wsUnregisterGroup({ groupId: group_id }));

export const wsListGroups = () =>
  run<WsGroupRecord[]>("ws_list_groups", (c) => c.wsListGroups(), v1Record);

export const wsSetMemberRole = (identity: string, role: string) =>
  run<void>("ws_set_member_role", (c) => c.wsSetMemberRole({
    identity,
    role,
  }));

export const wsGetMemberRole = (identity: string) =>
  run<string>("ws_get_member_role", (c) => c.wsGetMemberRole({ identity }));

export const wsMyRole = () =>
  run<string>("ws_my_role", (c) => c.wsMyRole());

export const wsListMembers = () =>
  run<MemberRecord[]>("ws_list_members", (c) => c.wsListMembers(), v1Record);

export const wsPingChannel = (target_context_id: string) =>
  run<void>("ws_ping_channel", (c) => c.wsPingChannel({
    targetContextId: target_context_id,
  }));

/**
 * Pongs this context has received.
 *
 * `ws_ping_channel` only QUEUES the xcall, so its result says "queued", never
 * "delivered". This counter on the *target* is the only way to see one land —
 * which is why the ping card reads it back rather than trusting its own reply.
 */
export const wsPingCount = () =>
  run<number>("ws_ping_count", (c) => c.wsPingCount(), int);

/**
 * The pong receiver. It accepts another APP as its caller only, so calling it
 * from here (as an account) is refused with `Invalid` — the call exists to show
 * that refusal.
 */
export const wsPong = (from_context: string) =>
  run<void>("ws_pong", (c) => c.wsPong({ fromContext: from_context }));

// AuthoredMap
export const authoredInsert = (key: string, value: string) =>
  run<void>("authored_insert", (c) => c.authoredInsert({ key, value }));

export const authoredUpdate = (key: string, value: string) =>
  run<void>("authored_update", (c) => c.authoredUpdate({ key, value }));

export const authoredRemove = (key: string) =>
  run<string | null>("authored_remove", (c) => c.authoredRemove({ key }));

export const authoredGet = (key: string) =>
  run<string | null>("authored_get", (c) => c.authoredGet({ key }));

export const authoredEntries = () =>
  run<Record<string, string>>("authored_entries", (c) => c.authoredEntries());

export const authoredGetOwner = (key: string) =>
  run<string | null>("authored_get_owner", (c) => c.authoredGetOwner({ key }));

export const authoredGetBy = (owner: string, key: string) =>
  run<string | null>("authored_get_by", (c) => c.authoredGetBy({ owner, key }));

export const authoredOwners = (key: string) =>
  run<string[]>("authored_owners", (c) => c.authoredOwners({ key }));

export const authoredLen = () =>
  run<number>("authored_len", (c) => c.authoredLen(), int);

// AuthoredVector
export const authoredVecPush = (value: string) =>
  run<number>("authored_vec_push", (c) => c.authoredVecPush({ value }), int);

export const authoredVecGet = (index: number) =>
  run<string | null>("authored_vec_get", (c) => c.authoredVecGet({ index: u64(index) }));

export const authoredVecUpdate = (index: number, value: string) =>
  run<void>("authored_vec_update", (c) => c.authoredVecUpdate({ index: u64(index), value }));

export const authoredVecRemove = (index: number) =>
  run<void>("authored_vec_remove", (c) => c.authoredVecRemove({ index: u64(index) }));

export const authoredVecGetOwner = (index: number) =>
  run<string | null>("authored_vec_get_owner", (c) => c.authoredVecGetOwner({ index: u64(index) }));

export const authoredVecEntries = () =>
  run<string[]>("authored_vec_entries", (c) => c.authoredVecEntries());

export const authoredVecLen = () =>
  run<number>("authored_vec_len", (c) => c.authoredVecLen(), int);

// SharedStorage
export const sharedSet = (value: string) =>
  run<void>("shared_set", (c) => c.sharedSet({ value }));

export const sharedGet = () =>
  run<string>("shared_get", (c) => c.sharedGet());

export const sharedGetWriters = () =>
  run<string[]>("shared_get_writers", (c) => c.sharedGetWriters());

// The writer set is keyed by ACCOUNT id, not by the device
// device key the rest of this API uses — core 0.11 made the account the only
// authorization subject. Get yours from whoami().
export const sharedAddWriter = (account_hex: string) =>
  run<void>("shared_add_writer", (c) => c.sharedAddWriter({ accountHex: account_hex }));

/**
 * Replace the whole writer set.
 *
 * `sharedAddWriter` can only union a key in, so it can never take one away.
 * This is the only way to REVOKE, and it is not reversible from the caller's
 * side: rotate to a set that excludes yourself and you are out.
 */
export const sharedRotateWriters = (account_hexes: string[]) =>
  run<void>("shared_rotate_writers", (c) => c.sharedRotateWriters({
    accountHexes: account_hexes,
  }));

export const sharedIsWriter = (account_hex: string) =>
  run<boolean>("shared_is_writer", (c) => c.sharedIsWriter({ accountHex: account_hex }));

// ── Access Control ───────────────────────────────────────────────────────────
//
// Two layers that look alike and are not. `acl*` is a REGISTRY of named roles;
// `aclCapabilities` is the per-account op mask that the merge check actually
// reads, and it is PROJECTED from the registry by `aclProject` as a separate
// signed action. A grant is only in force once it has been projected — comparing
// `aclMembersOf` against `aclCapabilities` is how you see one that has not been.

export const aclIsAdmin = (account_hex: string) =>
  run<boolean>("acl_is_admin", (c) => c.aclIsAdmin({ accountHex: account_hex }));

export const aclAdmins = () =>
  run<string[]>("acl_admins", (c) => c.aclAdmins());

/**
 * Add an admin. **Projects as part of the same call.**
 *
 * Admin-ness lives on the registry, but `acl_project` writes the guarded
 * document and is gated on that document's capability map — so an admin who has
 * not been projected cannot run the projection that would grant it the mask.
 * Role grants deliberately do NOT self-project; admin grants have to.
 */
export const aclGrantAdmin = (account_hex: string) =>
  run<void>("acl_grant_admin", (c) => c.aclGrantAdmin({ accountHex: account_hex }));

export const aclRevokeAdmin = (account_hex: string) =>
  run<void>("acl_revoke_admin", (c) => c.aclRevokeAdmin({ accountHex: account_hex }));

/** role -> the operations it confers. The contract is the authority on this. */
export const aclRoles = () =>
  run<Record<string, string[]>>("acl_roles", (c) => c.aclRoles());

export const aclGrant = (role: string, account_hex: string) =>
  run<void>("acl_grant", (c) => c.aclGrant({ role, accountHex: account_hex }));

export const aclRevoke = (role: string, account_hex: string) =>
  run<void>("acl_revoke", (c) => c.aclRevoke({ role, accountHex: account_hex }));

export const aclHasRole = (role: string, account_hex: string) =>
  run<boolean>("acl_has_role", (c) => c.aclHasRole({ role, accountHex: account_hex }));

export const aclMembersOf = (role: string) =>
  run<string[]>("acl_members_of", (c) => c.aclMembersOf({ role }));

export const aclMyRoles = () =>
  run<string[]>("acl_my_roles", (c) => c.aclMyRoles());

/** Re-run after ANY grant, revoke or admin change. Returns the account count. */
export const aclProject = () =>
  run<number>("acl_project", (c) => c.aclProject(), int);

/** account -> operations. This, not the role registry, is what merge enforces. */
export const aclCapabilities = () =>
  run<Record<string, string[]>>("acl_capabilities", (c) => c.aclCapabilities());

export const aclDocSet = (value: string) =>
  run<void>("acl_doc_set", (c) => c.aclDocSet({ value }));

export const aclDocGet = () =>
  run<string>("acl_doc_get", (c) => c.aclDocGet());

// ── Ownable ──────────────────────────────────────────────────────────────────

export const ownedOwner = () =>
  run<string | null>("owned_owner", (c) => c.ownedOwner());

export const ownedIsOwner = (account_hex: string) =>
  run<boolean>("owned_is_owner", (c) => c.ownedIsOwner({ accountHex: account_hex }));

export const ownedSet = (value: string) =>
  run<void>("owned_set", (c) => c.ownedSet({ value }));

export const ownedGet = () =>
  run<string>("owned_get", (c) => c.ownedGet());

/** One-way: after this the previous owner is no longer a writer. */
export const ownedTransfer = (account_hex: string) =>
  run<void>("owned_transfer", (c) => c.ownedTransfer({ accountHex: account_hex }));

export const sharedIsFrozen = () =>
  run<boolean>("shared_is_frozen", (c) => c.sharedIsFrozen());
