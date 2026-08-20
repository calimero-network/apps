import { rpcRaw } from "./rpc";

// Every section displays what the node returned, so these return the JSON-RPC
// envelope (`{ result: { output, logs } }` or `{ error }`) rather than a bare
// value — that is what `ResultBox` renders and what the Test Runner asserts on.
//
// The executor public key used to be passed with every call. It is not any more:
// the node derives the caller from the bearer token, which is the only version it
// would trust. `whoami` is how the UI learns both halves of its own identity.
function call<A extends Record<string, unknown>, R>(method: string, argsJson: A) {
  return rpcRaw<R>(method, argsJson);
}

/** Both halves of the caller's identity — see the contract's `whoami`. */
export interface Identity {
  /** This installation, base58. What `authored_*` reports as an owner. */
  device_id: string;
  /** The person, 64 hex chars. What the `shared_*` writer set is keyed by. */
  account_id: string;
}

export const whoami = () =>
  call<Record<string, never>, Identity>("whoami", {});

export const kvSet = (key: string, value: string) =>
  call("set", { key, value });

export const kvSetWithHandler = (key: string, value: string) =>
  call("set_with_handler", { key, value });

export const kvGet = (key: string) =>
  call<{ key: string }, string | null>("get", { key });

export const kvGetResult = (key: string) =>
  call<{ key: string }, string>("get_result", { key });

export const kvEntries = () =>
  call<Record<string, never>, Record<string, string>>("entries", {});

export const kvLen = () => call<Record<string, never>, number>("len", {});

export const kvRemove = (key: string) =>
  call<{ key: string }, string | null>("remove", { key });

export const kvRemoveWithHandler = (key: string) =>
  call<{ key: string }, string | null>("remove_with_handler", { key });

export const kvClear = () => call<Record<string, never>, void>("clear", {});

export const kvClearWithHandler = () =>
  call<Record<string, never>, void>("clear_with_handler", {});

export const insertHandler = (key: string, value: string) =>
  call("insert_handler", { key, value });

export const updateHandler = (key: string, value: string) =>
  call("update_handler", { key, value });

export const removeHandler = (key: string) =>
  call<{ key: string }, void>("remove_handler", { key });

export const clearHandler = () =>
  call<Record<string, never>, void>("clear_handler", {});

export const getHandlerExecutionCount = () =>
  call<Record<string, never>, number>("get_handler_execution_count", {});

export const setUserSimple = (value: string) =>
  call("set_user_simple", { value });

export const getUserSimple = () =>
  call<Record<string, never>, string | null>("get_user_simple", {});

/**
 * Read another user's `UserStorage` slot, addressed by ACCOUNT (64 hex).
 *
 * Not the base58 device key: rc.21 rekeyed `UserStorage` by account, so a
 * device key names a slot nobody writes to and this answers `null` forever
 * instead of erroring. Get the value from `whoami().account_id`.
 */
export const getUserSimpleFor = (account_hex: string) =>
  call<{ account_hex: string }, string | null>("get_user_simple_for", {
    account_hex,
  });

export const setUserNested = (key: string, value: string) =>
  call("set_user_nested", { key, value });

export const getUserNested = (key: string) =>
  call<{ key: string }, string | null>("get_user_nested", { key });

export const addFrozen = (value: string) =>
  call<{ value: string }, string>("add_frozen", { value });

export const getFrozen = (hash_hex: string) =>
  call<{ hash_hex: string }, string>("get_frozen", { hash_hex });

export const addSecret = (game_id: string, secret: string) =>
  call("add_secret", { game_id, secret });

export const addGuess = (game_id: string, guess: string) =>
  call<{ game_id: string; guess: string }, boolean>("add_guess", {
    game_id,
    guess,
  });

export const mySecrets = () =>
  call<Record<string, never>, Record<string, string>>("my_secrets", {});

export const games = () =>
  call<Record<string, never>, Record<string, string>>("games", {});

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
) => call<{ name: string; blob_id_str: string; size: number; mime_type: string }, string>("upload_file", { name, blob_id_str, size, mime_type });

export const deleteFile = (file_id: string) =>
  call<{ file_id: string }, void>("delete_file", { file_id });

export const listFiles = () =>
  call<Record<string, never>, FileRecord[]>("list_files", {});

export const getFile = (file_id: string) =>
  call<{ file_id: string }, FileRecord>("get_file", { file_id });

export const getBlobIdB58 = (file_id: string) =>
  call<{ file_id: string }, string>("get_blob_id_b58", { file_id });

export const searchFiles = (query: string) =>
  call<{ query: string }, FileRecord[]>("search_files", { query });

export const incrementGCounter = (key: string) =>
  call<{ key: string }, number>("increment_g_counter", { key });

export const getGCounter = (key: string) =>
  call<{ key: string }, number>("get_g_counter", { key });

export const incrementPnCounter = (key: string) =>
  call<{ key: string }, number>("increment_pn_counter", { key });

export const decrementPnCounter = (key: string) =>
  call<{ key: string }, number>("decrement_pn_counter", { key });

export const getPnCounter = (key: string) =>
  call<{ key: string }, number>("get_pn_counter", { key });

export const setRegister = (key: string, value: string) =>
  call("set_register", { key, value });

export const getRegister = (key: string) =>
  call<{ key: string }, string>("get_register", { key });

export const setMetadata = (
  outer_key: string,
  inner_key: string,
  value: string,
) => call("set_metadata", { outer_key, inner_key, value });

export const getMetadata = (outer_key: string, inner_key: string) =>
  call<{ outer_key: string; inner_key: string }, string>("get_metadata", {
    outer_key,
    inner_key,
  });

export const pushMetric = (value: number) =>
  call<{ value: number }, number>("push_metric", { value });

export const getMetric = (index: number) =>
  call<{ index: number }, number>("get_metric", { index });

export const metricsLen = () =>
  call<Record<string, never>, number>("metrics_len", {});

export const addTag = (key: string, tag: string) =>
  call("add_tag", { key, tag });

export const hasTag = (key: string, tag: string) =>
  call<{ key: string; tag: string }, boolean>("has_tag", { key, tag });

export const getTagCount = (key: string) =>
  call<{ key: string }, number>("get_tag_count", { key });

// ── Sorted collections ───────────────────────────────────────────────────────
//
// `SortedMap`/`SortedSet` are not sorted flavours of the unordered pair above:
// only these maintain the WASM host's ORDERED INDEX, which is what makes a range
// query or "the largest key" a seek instead of a full scan. Ranges are half-open
// — `[start, end)`, like every Rust range — so `end` is never returned.

export const sortedSet = (key: string, value: string) =>
  call("sorted_set", { key, value });

export const sortedGet = (key: string) =>
  call<{ key: string }, string | null>("sorted_get", { key });

export const sortedKeys = () =>
  call<Record<string, never>, string[]>("sorted_keys", {});

export const sortedRange = (start: string, end: string) =>
  call<{ start: string; end: string }, Record<string, string>>("sorted_range", {
    start,
    end,
  });

export const sortedLastKey = () =>
  call<Record<string, never>, string | null>("sorted_last_key", {});

export const sortedRemove = (key: string) =>
  call<{ key: string }, boolean>("sorted_remove", { key });

export const sortedLen = () =>
  call<Record<string, never>, number>("sorted_len", {});

export const sortedTagAdd = (tag: string) =>
  call<{ tag: string }, boolean>("sorted_tag_add", { tag });

export const sortedTagRemove = (tag: string) =>
  call<{ tag: string }, boolean>("sorted_tag_remove", { tag });

export const sortedTagContains = (tag: string) =>
  call<{ tag: string }, boolean>("sorted_tag_contains", { tag });

export const sortedTagsAll = () =>
  call<Record<string, never>, string[]>("sorted_tags_all", {});

export const sortedTagsRange = (start: string, end: string) =>
  call<{ start: string; end: string }, string[]>("sorted_tags_range", {
    start,
    end,
  });

export const sortedTagsLast = () =>
  call<Record<string, never>, string | null>("sorted_tags_last", {});

export const rgaInsertText = (position: number, text: string) =>
  call("rga_insert_text", { position, text });

export const rgaDeleteText = (start: number, end: number) =>
  call("rga_delete_text", { start, end });

export const rgaGetText = () =>
  call<Record<string, never>, string>("rga_get_text", {});

export const rgaGetLength = () =>
  call<Record<string, never>, number>("rga_get_length", {});

export const rgaIsEmpty = () =>
  call<Record<string, never>, boolean>("rga_is_empty", {});

export const rgaSetTitle = (new_title: string) =>
  call("rga_set_title", { new_title });

export const rgaGetTitle = () =>
  call<Record<string, never>, string>("rga_get_title", {});

export const rgaAppendText = (text: string) =>
  call("rga_append_text", { text });

export const rgaClear = () =>
  call<Record<string, never>, void>("rga_clear", {});


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
  call<{ name: string }, void>("ws_init", { name });

export const wsGetInfo = () =>
  call<Record<string, never>, WorkspaceInfo>("ws_get_info", {});

export const wsRegisterChannel = (context_id: string, name: string, topic: string) =>
  call<{ context_id: string; name: string; topic: string }, void>(
    "ws_register_channel",
    { context_id, name, topic },
  );

export const wsUnregisterChannel = (context_id: string) =>
  call<{ context_id: string }, void>("ws_unregister_channel", { context_id });

export const wsListChannels = () =>
  call<Record<string, never>, ChannelRecord[]>("ws_list_channels", {});

export const wsRegisterGroup = (group_id: string, name: string, description: string) =>
  call<{ group_id: string; name: string; description: string }, void>(
    "ws_register_group",
    { group_id, name, description },
  );

export const wsUnregisterGroup = (group_id: string) =>
  call<{ group_id: string }, void>("ws_unregister_group", { group_id });

export const wsListGroups = () =>
  call<Record<string, never>, WsGroupRecord[]>("ws_list_groups", {});

export const wsSetMemberRole = (identity: string, role: string) =>
  call<{ identity: string; role: string }, void>("ws_set_member_role", {
    identity,
    role,
  });

export const wsGetMemberRole = (identity: string) =>
  call<{ identity: string }, string>("ws_get_member_role", { identity });

export const wsMyRole = () =>
  call<Record<string, never>, string>("ws_my_role", {});

export const wsListMembers = () =>
  call<Record<string, never>, MemberRecord[]>("ws_list_members", {});

export const wsPingChannel = (target_context_id_b58: string) =>
  call<{ target_context_id_b58: string }, void>("ws_ping_channel", {
    target_context_id_b58,
  });

/**
 * Pongs this context has received.
 *
 * `ws_ping_channel` only QUEUES the xcall, so its result says "queued", never
 * "delivered". This counter on the *target* is the only way to see one land —
 * which is why the ping card reads it back rather than trusting its own reply.
 */
export const wsPingCount = () =>
  call<Record<string, never>, number>("ws_ping_count", {});

// AuthoredMap
export const authoredInsert = (key: string, value: string) =>
  call<{ key: string; value: string }, void>("authored_insert", { key, value });

export const authoredUpdate = (key: string, value: string) =>
  call<{ key: string; value: string }, void>("authored_update", { key, value });

export const authoredRemove = (key: string) =>
  call<{ key: string }, string | null>("authored_remove", { key });

export const authoredGet = (key: string) =>
  call<{ key: string }, string | null>("authored_get", { key });

export const authoredEntries = () =>
  call<Record<string, never>, Record<string, string>>("authored_entries", {});

export const authoredGetOwner = (key: string) =>
  call<{ key: string }, string | null>("authored_get_owner", { key });

export const authoredLen = () =>
  call<Record<string, never>, number>("authored_len", {});

// AuthoredVector
export const authoredVecPush = (value: string) =>
  call<{ value: string }, number>("authored_vec_push", { value });

export const authoredVecGet = (index: number) =>
  call<{ index: number }, string | null>("authored_vec_get", { index });

export const authoredVecUpdate = (index: number, value: string) =>
  call<{ index: number; value: string }, void>("authored_vec_update", { index, value });

export const authoredVecRemove = (index: number) =>
  call<{ index: number }, void>("authored_vec_remove", { index });

export const authoredVecGetOwner = (index: number) =>
  call<{ index: number }, string | null>("authored_vec_get_owner", { index });

export const authoredVecEntries = () =>
  call<Record<string, never>, string[]>("authored_vec_entries", {});

export const authoredVecLen = () =>
  call<Record<string, never>, number>("authored_vec_len", {});

// SharedStorage
export const sharedSet = (value: string) =>
  call<{ value: string }, void>("shared_set", { value });

export const sharedGet = () =>
  call<Record<string, never>, string>("shared_get", {});

export const sharedGetWriters = () =>
  call<Record<string, never>, string[]>("shared_get_writers", {});

// The writer set is keyed by ACCOUNT id (64 hex chars), not by the base58
// device key the rest of this API uses — core 0.11 made the account the only
// authorization subject. Get yours from whoami().
export const sharedAddWriter = (account_hex: string) =>
  call<{ account_hex: string }, void>("shared_add_writer", { account_hex });

/**
 * Replace the whole writer set.
 *
 * `sharedAddWriter` can only union a key in, so it can never take one away.
 * This is the only way to REVOKE, and it is not reversible from the caller's
 * side: rotate to a set that excludes yourself and you are out.
 */
export const sharedRotateWriters = (account_hexes: string[]) =>
  call<{ account_hexes: string[] }, void>("shared_rotate_writers", {
    account_hexes,
  });

export const sharedIsWriter = (account_hex: string) =>
  call<{ account_hex: string }, boolean>("shared_is_writer", { account_hex });

// ── Access Control ───────────────────────────────────────────────────────────
//
// Two layers that look alike and are not. `acl*` is a REGISTRY of named roles;
// `aclCapabilities` is the per-account op mask that the merge check actually
// reads, and it is PROJECTED from the registry by `aclProject` as a separate
// signed action. A grant is only in force once it has been projected — comparing
// `aclMembersOf` against `aclCapabilities` is how you see one that has not been.

export const aclIsAdmin = (account_hex: string) =>
  call<{ account_hex: string }, boolean>("acl_is_admin", { account_hex });

export const aclAdmins = () =>
  call<Record<string, never>, string[]>("acl_admins", {});

/**
 * Add an admin. **Projects as part of the same call.**
 *
 * Admin-ness lives on the registry, but `acl_project` writes the guarded
 * document and is gated on that document's capability map — so an admin who has
 * not been projected cannot run the projection that would grant it the mask.
 * Role grants deliberately do NOT self-project; admin grants have to.
 */
export const aclGrantAdmin = (account_hex: string) =>
  call<{ account_hex: string }, void>("acl_grant_admin", { account_hex });

export const aclRevokeAdmin = (account_hex: string) =>
  call<{ account_hex: string }, void>("acl_revoke_admin", { account_hex });

/** role -> the operations it confers. The contract is the authority on this. */
export const aclRoles = () =>
  call<Record<string, never>, Record<string, string[]>>("acl_roles", {});

export const aclGrant = (role: string, account_hex: string) =>
  call<{ role: string; account_hex: string }, void>("acl_grant", { role, account_hex });

export const aclRevoke = (role: string, account_hex: string) =>
  call<{ role: string; account_hex: string }, void>("acl_revoke", { role, account_hex });

export const aclHasRole = (role: string, account_hex: string) =>
  call<{ role: string; account_hex: string }, boolean>("acl_has_role", { role, account_hex });

export const aclMembersOf = (role: string) =>
  call<{ role: string }, string[]>("acl_members_of", { role });

export const aclMyRoles = () =>
  call<Record<string, never>, string[]>("acl_my_roles", {});

/** Re-run after ANY grant, revoke or admin change. Returns the account count. */
export const aclProject = () =>
  call<Record<string, never>, number>("acl_project", {});

/** account -> operations. This, not the role registry, is what merge enforces. */
export const aclCapabilities = () =>
  call<Record<string, never>, Record<string, string[]>>("acl_capabilities", {});

export const aclDocSet = (value: string) =>
  call<{ value: string }, void>("acl_doc_set", { value });

export const aclDocGet = () =>
  call<Record<string, never>, string>("acl_doc_get", {});

// ── Ownable ──────────────────────────────────────────────────────────────────

export const ownedOwner = () =>
  call<Record<string, never>, string | null>("owned_owner", {});

export const ownedIsOwner = (account_hex: string) =>
  call<{ account_hex: string }, boolean>("owned_is_owner", { account_hex });

export const ownedSet = (value: string) =>
  call<{ value: string }, void>("owned_set", { value });

export const ownedGet = () =>
  call<Record<string, never>, string>("owned_get", {});

/** One-way: after this the previous owner is no longer a writer. */
export const ownedTransfer = (account_hex: string) =>
  call<{ account_hex: string }, void>("owned_transfer", { account_hex });

export const sharedIsFrozen = () =>
  call<Record<string, never>, boolean>("shared_is_frozen", {});
