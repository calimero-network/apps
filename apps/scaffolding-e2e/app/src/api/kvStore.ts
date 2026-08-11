import {
  getContextId,
  getExecutorPublicKey,
  rpcClient,
} from "@calimero-network/calimero-client";

function ctx() {
  return {
    contextId: getContextId() ?? "",
    executorPublicKey: getExecutorPublicKey() ?? "",
  };
}

function call<A extends Record<string, unknown>, R>(method: string, argsJson: A) {
  const { contextId, executorPublicKey } = ctx();
  return rpcClient.execute<A, R>(
    { contextId, method, argsJson, executorPublicKey },
    { headers: { "Content-Type": "application/json" } },
  );
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

export const getUserSimpleFor = (user_key: string) =>
  call<{ user_key: string }, string | null>("get_user_simple_for", {
    user_key,
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
  created_by: string;
}

export interface WsGroupRecord {
  group_id: string;
  name: string;
  description: string;
  created_by: string;
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

export const sharedIsWriter = (account_hex: string) =>
  call<{ account_hex: string }, boolean>("shared_is_writer", { account_hex });

export const sharedIsFrozen = () =>
  call<Record<string, never>, boolean>("shared_is_frozen", {});
