/**
 * JSON-RPC contract tests — live merod node, no browser.
 *
 * Covers every WASM method: set_profile, get_profiles, get_info, update_info,
 * send_message, get_messages, update_reaction, edit_message, delete_message,
 * and thread replies.
 *
 * Prerequisites:
 *   ./scripts/dev-node.sh   ← builds WASM, starts node, writes app/.env.integration
 *
 * Run:
 *   pnpm exec playwright test --project=rpc
 *   pnpm exec playwright test --project=rpc -g "reactions"
 */

import { test, expect } from "@playwright/test";
import {
  makeClient,
  makeClient2,
  envAvailable,
  twoNodeEnvAvailable,
  getEnv,
} from "./helpers/rpc-client";

// ── Skip entire suite if node not configured ─────────────────────────────────

function requireEnv() {
  if (!envAvailable()) {
    test.skip();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Profile / Identity
// ─────────────────────────────────────────────────────────────────────────────

test.describe("set_profile / get_profiles / get_username", () => {
  test.beforeAll(requireEnv);

  test("set_profile returns 'Profile set'", async () => {
    const client = makeClient();
    const result = await client.call<string>("set_profile", {
      username: "TestUser",
      avatar: null,
    });
    expect(result).toBe("Profile set");
  });

  test("get_profiles returns array containing the set profile", async () => {
    const client = makeClient();
    await client.call("set_profile", { username: "TestUser", avatar: null });

    const profiles = await client.call<Array<{ identity: string; username: string; avatar: string | null }>>(
      "get_profiles",
      {},
    );
    expect(Array.isArray(profiles)).toBe(true);
    // Find by identity — username may be frozen to an earlier value if pre-seeded
    const ours = profiles.find((p) => p.identity === getEnv().memberKey);
    expect(ours).toBeTruthy();
    expect(typeof ours!.username).toBe("string");
    expect(ours!.username.length).toBeGreaterThan(0);
  });

  test("get_profiles shape has identity + username + avatar fields", async () => {
    const client = makeClient();
    await client.call("set_profile", { username: "ShapeCheck", avatar: null });
    const profiles = await client.call<Array<Record<string, unknown>>>("get_profiles", {});
    expect(profiles.length).toBeGreaterThan(0);
    const p = profiles[0];
    expect(typeof p.identity).toBe("string");
    expect(typeof p.username).toBe("string");
    expect("avatar" in p).toBe(true);
  });

  test("set_profile rejects empty username", async () => {
    const client = makeClient();
    const { ok, error } = await client.tryCall("set_profile", { username: "", avatar: null });
    expect(ok).toBe(false);
    expect(error).toMatch(/cannot be empty/i);
  });

  test("set_profile rejects username longer than 50 characters", async () => {
    const client = makeClient();
    const { ok, error } = await client.tryCall("set_profile", {
      username: "a".repeat(51),
      avatar: null,
    });
    expect(ok).toBe(false);
    expect(error).toMatch(/50 characters/i);
  });

  test("set_profile accepts username with exactly 50 characters", async () => {
    const client = makeClient();
    const result = await client.call<string>("set_profile", {
      username: "a".repeat(50),
      avatar: null,
    });
    expect(result).toBe("Profile set");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Channel Info
// ─────────────────────────────────────────────────────────────────────────────

test.describe("get_info / update_info", () => {
  test.beforeAll(requireEnv);

  test("get_info returns correct shape", async () => {
    const client = makeClient();
    const info = await client.call<{
      name: string;
      context_type: string;
      description: string;
      created_at: number;
    }>("get_info", {});
    expect(typeof info.name).toBe("string");
    expect(typeof info.context_type).toBe("string");
    expect(typeof info.description).toBe("string");
    expect(typeof info.created_at).toBe("number");
    expect(info.created_at).toBeGreaterThan(0);
  });

  test("get_info context_type is 'Channel'", async () => {
    const client = makeClient();
    const info = await client.call<{ context_type: string }>("get_info", {});
    expect(info.context_type).toBe("Channel");
  });

  test("update_info changes name", async () => {
    const client = makeClient();
    const newName = `updated-${Date.now()}`;
    const result = await client.call<string>("update_info", {
      name: newName,
      description: null,
    });
    expect(result).toBe("Info updated");

    const info = await client.call<{ name: string }>("get_info", {});
    expect(info.name).toBe(newName);

    // restore
    await client.call("update_info", { name: "general", description: null });
  });

  test("update_info with null name leaves name unchanged", async () => {
    const client = makeClient();
    const before = await client.call<{ name: string }>("get_info", {});
    await client.call("update_info", { name: null, description: "new-desc" });
    const after = await client.call<{ name: string }>("get_info", {});
    expect(after.name).toBe(before.name);
    // restore
    await client.call("update_info", { name: null, description: "" });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. send_message / get_messages
// ─────────────────────────────────────────────────────────────────────────────

interface MessageOut {
  id: string;
  text: string;
  sender: string;
  sender_username: string;
  timestamp: number;
  mentions: string[];
  mentions_usernames: string[];
  files: AttachmentOut[];
  images: AttachmentOut[];
  deleted: boolean | null;
  edited_on: number | null;
  reactions: Record<string, string[]> | null;
  thread_count: number;
  thread_last_timestamp: number;
}

interface AttachmentOut {
  name: string;
  blob_id: string;
  mime_type: string;
  size: number;
  uploaded_at: number;
}

interface GetMessagesOut {
  messages: MessageOut[];
  total_count: number;
  start_position: number;
}

test.describe("send_message / get_messages", () => {
  test.beforeAll(requireEnv);

  test("send_message returns correct Message shape", async () => {
    const client = makeClient();
    const ts = Math.floor(Date.now() / 1000);
    const marker = `shape-check-${Date.now()}`;

    const msg = await client.call<MessageOut>("send_message", {
      message: marker,
      mentions: [],
      mentions_usernames: [],
      parent_message: null,
      timestamp: ts,
      sender_username: "TestUser",
      files: null,
      images: null,
    });

    expect(typeof msg.id).toBe("string");
    expect(msg.id.length).toBeGreaterThan(0);
    expect(msg.text).toBe(marker);
    expect(typeof msg.sender).toBe("string");
    expect(msg.timestamp).toBe(ts);
    expect(Array.isArray(msg.files)).toBe(true);
    expect(Array.isArray(msg.images)).toBe(true);
    expect(msg.deleted).toBeNull();
    expect(msg.edited_on).toBeNull();
  });

  test("get_messages returns the sent message", async () => {
    const client = makeClient();
    const marker = `get-msg-${Date.now()}`;
    await client.call("send_message", {
      message: marker,
      mentions: [],
      mentions_usernames: [],
      parent_message: null,
      timestamp: Math.floor(Date.now() / 1000),
      sender_username: "TestUser",
      files: null,
      images: null,
    });

    const result = await client.call<GetMessagesOut>("get_messages", {
      parent_message: null,
      limit: 50,
      offset: 0,
      search_term: marker,
    });
    expect(result.messages.length).toBeGreaterThan(0);
    expect(result.messages.some((m) => m.text === marker)).toBe(true);
    expect(result.total_count).toBeGreaterThan(0);
  });

  test("get_messages shape: total_count, messages, start_position", async () => {
    const client = makeClient();
    const result = await client.call<GetMessagesOut>("get_messages", {
      parent_message: null,
      limit: 5,
      offset: 0,
      search_term: null,
    });
    expect(typeof result.total_count).toBe("number");
    expect(Array.isArray(result.messages)).toBe(true);
    expect(typeof result.start_position).toBe("number");
  });

  test("get_messages limit restricts returned count", async () => {
    const client = makeClient();
    // Seed at least 3 messages
    for (let i = 0; i < 3; i++) {
      await client.call("send_message", {
        message: `limit-test-${i}-${Date.now()}`,
        mentions: [],
        mentions_usernames: [],
        parent_message: null,
        timestamp: Math.floor(Date.now() / 1000),
        sender_username: "TestUser",
        files: null,
        images: null,
      });
    }

    const result = await client.call<GetMessagesOut>("get_messages", {
      parent_message: null,
      limit: 2,
      offset: 0,
      search_term: null,
    });
    expect(result.messages.length).toBeLessThanOrEqual(2);
    expect(result.total_count).toBeGreaterThanOrEqual(3);
  });

  test("get_messages search_term filters correctly", async () => {
    const client = makeClient();
    const uniqueMarker = `unique-search-xyz-${Date.now()}`;
    await client.call("send_message", {
      message: uniqueMarker,
      mentions: [],
      mentions_usernames: [],
      parent_message: null,
      timestamp: Math.floor(Date.now() / 1000),
      sender_username: "TestUser",
      files: null,
      images: null,
    });

    const result = await client.call<GetMessagesOut>("get_messages", {
      parent_message: null,
      limit: 50,
      offset: 0,
      search_term: uniqueMarker,
    });
    expect(result.messages.length).toBe(1);
    expect(result.messages[0].text).toBe(uniqueMarker);
  });

  test("get_messages with no-match search returns empty", async () => {
    const client = makeClient();
    const result = await client.call<GetMessagesOut>("get_messages", {
      parent_message: null,
      limit: 50,
      offset: 0,
      search_term: "zzz-no-possible-match-xyzzy-99",
    });
    expect(result.messages).toHaveLength(0);
    expect(result.total_count).toBe(0);
  });

  test("get_messages messages have all required fields", async () => {
    const client = makeClient();
    const result = await client.call<GetMessagesOut>("get_messages", {
      parent_message: null,
      limit: 1,
      offset: 0,
      search_term: null,
    });
    if (result.messages.length === 0) return; // no messages seeded yet — skip
    const m = result.messages[0];
    expect(typeof m.id).toBe("string");
    expect(typeof m.text).toBe("string");
    expect(typeof m.sender).toBe("string");
    expect(typeof m.sender_username).toBe("string");
    expect(typeof m.timestamp).toBe("number");
    expect(Array.isArray(m.mentions)).toBe(true);
    expect(Array.isArray(m.mentions_usernames)).toBe(true);
    expect(Array.isArray(m.files)).toBe(true);
    expect(Array.isArray(m.images)).toBe(true);
    expect(typeof m.thread_count).toBe("number");
    expect(typeof m.thread_last_timestamp).toBe("number");
  });

  test("send_message with mentions stores them correctly", async () => {
    const client = makeClient();
    const env = getEnv();
    const ts = Math.floor(Date.now() / 1000);

    const msg = await client.call<MessageOut>("send_message", {
      message: `mention-test-${ts}`,
      mentions: [env.memberKey],
      mentions_usernames: ["TestUser"],
      parent_message: null,
      timestamp: ts,
      sender_username: "TestUser",
      files: null,
      images: null,
    });

    expect(Array.isArray(msg.mentions)).toBe(true);
    expect(msg.mentions).toContain(env.memberKey);
    expect(Array.isArray(msg.mentions_usernames)).toBe(true);
    expect(msg.mentions_usernames).toContain("TestUser");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Reactions
// ─────────────────────────────────────────────────────────────────────────────

test.describe("update_reaction", () => {
  test.beforeAll(requireEnv);

  async function seedMessage(text: string) {
    const client = makeClient();
    return client.call<MessageOut>("send_message", {
      message: text,
      mentions: [],
      mentions_usernames: [],
      parent_message: null,
      timestamp: Math.floor(Date.now() / 1000),
      sender_username: "TestUser",
      files: null,
      images: null,
    });
  }

  test("update_reaction add returns success string", async () => {
    const client = makeClient();
    const msg = await seedMessage(`react-add-${Date.now()}`);
    const result = await client.call<string>("update_reaction", {
      message_id: msg.id,
      emoji: "👍",
      user: getEnv().memberKey,
      add: true,
    });
    expect(result).toMatch(/added/i);
  });

  test("get_messages shows reaction after add", async () => {
    const client = makeClient();
    const env = getEnv();
    const marker = `react-verify-${Date.now()}`;
    const msg = await seedMessage(marker);

    await client.call("update_reaction", {
      message_id: msg.id,
      emoji: "❤️",
      user: env.memberKey,
      add: true,
    });

    const result = await client.call<GetMessagesOut>("get_messages", {
      parent_message: null,
      limit: 50,
      offset: 0,
      search_term: marker,
    });
    const found = result.messages.find((m) => m.id === msg.id);
    expect(found).toBeTruthy();
    expect(found!.reactions).toBeTruthy();
    expect(found!.reactions!["❤️"]).toContain(env.memberKey);
  });

  test("update_reaction remove clears the reaction", async () => {
    const client = makeClient();
    const env = getEnv();
    const marker = `react-remove-${Date.now()}`;
    const msg = await seedMessage(marker);

    await client.call("update_reaction", {
      message_id: msg.id,
      emoji: "🔥",
      user: env.memberKey,
      add: true,
    });
    await client.call("update_reaction", {
      message_id: msg.id,
      emoji: "🔥",
      user: env.memberKey,
      add: false,
    });

    const result = await client.call<GetMessagesOut>("get_messages", {
      parent_message: null,
      limit: 50,
      offset: 0,
      search_term: marker,
    });
    const found = result.messages.find((m) => m.id === msg.id);
    expect(found).toBeTruthy();
    const fire = found!.reactions?.["🔥"];
    expect(!fire || fire.length === 0).toBe(true);
  });

  test("adding same reaction twice is idempotent", async () => {
    const client = makeClient();
    const env = getEnv();
    const marker = `react-dedup-${Date.now()}`;
    const msg = await seedMessage(marker);

    await client.call("update_reaction", {
      message_id: msg.id,
      emoji: "😂",
      user: env.memberKey,
      add: true,
    });
    await client.call("update_reaction", {
      message_id: msg.id,
      emoji: "😂",
      user: env.memberKey,
      add: true,
    });

    const result = await client.call<GetMessagesOut>("get_messages", {
      parent_message: null,
      limit: 50,
      offset: 0,
      search_term: marker,
    });
    const found = result.messages.find((m) => m.id === msg.id);
    const users = found?.reactions?.["😂"] ?? [];
    const unique = new Set(users);
    expect(unique.size).toBe(users.length); // no duplicates
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Edit Message
// ─────────────────────────────────────────────────────────────────────────────

test.describe("edit_message", () => {
  test.beforeAll(requireEnv);

  async function seedMessage(text: string): Promise<MessageOut> {
    const client = makeClient();
    return client.call<MessageOut>("send_message", {
      message: text,
      mentions: [],
      mentions_usernames: [],
      parent_message: null,
      timestamp: Math.floor(Date.now() / 1000),
      sender_username: "TestUser",
      files: null,
      images: null,
    });
  }

  test("edit_message returns Message with updated text", async () => {
    const client = makeClient();
    const msg = await seedMessage(`edit-before-${Date.now()}`);
    const newText = `edit-after-${Date.now()}`;

    const edited = await client.call<MessageOut>("edit_message", {
      message_id: msg.id,
      new_message: newText,
      timestamp: Math.floor(Date.now() / 1000),
      parent_id: null,
    });

    expect(edited.text).toBe(newText);
    expect(edited.id).toBe(msg.id);
  });

  test("edit_message sets edited_on field", async () => {
    const client = makeClient();
    const msg = await seedMessage(`edit-ts-${Date.now()}`);
    const ts = Math.floor(Date.now() / 1000);

    const edited = await client.call<MessageOut>("edit_message", {
      message_id: msg.id,
      new_message: "edited text",
      timestamp: ts,
      parent_id: null,
    });

    expect(edited.edited_on).not.toBeNull();
    expect(edited.edited_on).toBe(ts);
  });

  test("get_messages shows edited text", async () => {
    const client = makeClient();
    const marker = `edit-verify-${Date.now()}`;
    const msg = await seedMessage(marker);
    const newText = `edited-${Date.now()}`;

    await client.call("edit_message", {
      message_id: msg.id,
      new_message: newText,
      timestamp: Math.floor(Date.now() / 1000),
      parent_id: null,
    });

    const result = await client.call<GetMessagesOut>("get_messages", {
      parent_message: null,
      limit: 50,
      offset: 0,
      search_term: newText,
    });
    expect(result.messages.some((m) => m.id === msg.id && m.text === newText)).toBe(true);
  });

  test("edit_message with non-existent id fails", async () => {
    const client = makeClient();
    const { ok, error } = await client.tryCall("edit_message", {
      message_id: "fake-message-id-that-does-not-exist",
      new_message: "new text",
      timestamp: Math.floor(Date.now() / 1000),
      parent_id: null,
    });
    expect(ok).toBe(false);
    expect(error).toMatch(/not found/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Delete Message
// ─────────────────────────────────────────────────────────────────────────────

test.describe("delete_message", () => {
  test.beforeAll(requireEnv);

  async function seedMessage(text: string): Promise<MessageOut> {
    const client = makeClient();
    return client.call<MessageOut>("send_message", {
      message: text,
      mentions: [],
      mentions_usernames: [],
      parent_message: null,
      timestamp: Math.floor(Date.now() / 1000),
      sender_username: "TestUser",
      files: null,
      images: null,
    });
  }

  test("delete_message returns success string", async () => {
    const client = makeClient();
    const msg = await seedMessage(`delete-test-${Date.now()}`);
    const result = await client.call<string>("delete_message", {
      message_id: msg.id,
      parent_id: null,
    });
    expect(result).toMatch(/deleted/i);
  });

  test("get_messages shows deleted flag after delete", async () => {
    const client = makeClient();
    const marker = `delete-verify-${Date.now()}`;
    const msg = await seedMessage(marker);

    await client.call("delete_message", { message_id: msg.id, parent_id: null });

    const result = await client.call<GetMessagesOut>("get_messages", {
      parent_message: null,
      limit: 50,
      offset: 0,
      search_term: null,
    });
    const found = result.messages.find((m) => m.id === msg.id);
    expect(found).toBeTruthy();
    expect(found!.deleted).not.toBeNull();
  });

  test("delete_message with non-existent id fails", async () => {
    const client = makeClient();
    const { ok, error } = await client.tryCall("delete_message", {
      message_id: "totally-fake-id-xyz",
      parent_id: null,
    });
    expect(ok).toBe(false);
    expect(error).toMatch(/not found/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. Thread Replies
// ─────────────────────────────────────────────────────────────────────────────

test.describe("threads (send_message with parent_message)", () => {
  test.beforeAll(requireEnv);

  async function seedMessage(text: string): Promise<MessageOut> {
    const client = makeClient();
    return client.call<MessageOut>("send_message", {
      message: text,
      mentions: [],
      mentions_usernames: [],
      parent_message: null,
      timestamp: Math.floor(Date.now() / 1000),
      sender_username: "TestUser",
      files: null,
      images: null,
    });
  }

  test("send_message with parent_message creates a thread reply", async () => {
    const client = makeClient();
    const parent = await seedMessage(`thread-parent-${Date.now()}`);
    const replyText = `thread-reply-${Date.now()}`;

    const reply = await client.call<MessageOut>("send_message", {
      message: replyText,
      mentions: [],
      mentions_usernames: [],
      parent_message: parent.id,
      timestamp: Math.floor(Date.now() / 1000),
      sender_username: "TestUser",
      files: null,
      images: null,
    });

    expect(reply.text).toBe(replyText);
    expect(typeof reply.id).toBe("string");
  });

  test("get_messages with parent_message returns thread replies", async () => {
    const client = makeClient();
    const parent = await seedMessage(`thread-get-${Date.now()}`);
    const replyText = `thread-reply-get-${Date.now()}`;

    await client.call("send_message", {
      message: replyText,
      mentions: [],
      mentions_usernames: [],
      parent_message: parent.id,
      timestamp: Math.floor(Date.now() / 1000),
      sender_username: "TestUser",
      files: null,
      images: null,
    });

    const thread = await client.call<GetMessagesOut>("get_messages", {
      parent_message: parent.id,
      limit: 50,
      offset: 0,
      search_term: null,
    });
    expect(thread.messages.length).toBeGreaterThan(0);
    expect(thread.messages.some((m) => m.text === replyText)).toBe(true);
  });

  test("parent message gets thread_count incremented", async () => {
    const client = makeClient();
    const marker = `thread-count-${Date.now()}`;
    const parent = await seedMessage(marker);

    await client.call("send_message", {
      message: "reply",
      mentions: [],
      mentions_usernames: [],
      parent_message: parent.id,
      timestamp: Math.floor(Date.now() / 1000),
      sender_username: "TestUser",
      files: null,
      images: null,
    });

    const result = await client.call<GetMessagesOut>("get_messages", {
      parent_message: null,
      limit: 50,
      offset: 0,
      search_term: marker,
    });
    const found = result.messages.find((m) => m.id === parent.id);
    expect(found).toBeTruthy();
    expect(found!.thread_count).toBeGreaterThan(0);
    expect(found!.thread_last_timestamp).toBeGreaterThan(0);
  });

  test("edit_message works on thread reply", async () => {
    const client = makeClient();
    const parent = await seedMessage(`thread-edit-parent-${Date.now()}`);
    const reply = await client.call<MessageOut>("send_message", {
      message: `thread-edit-before-${Date.now()}`,
      mentions: [],
      mentions_usernames: [],
      parent_message: parent.id,
      timestamp: Math.floor(Date.now() / 1000),
      sender_username: "TestUser",
      files: null,
      images: null,
    });

    const newText = `thread-edit-after-${Date.now()}`;
    const edited = await client.call<MessageOut>("edit_message", {
      message_id: reply.id,
      new_message: newText,
      timestamp: Math.floor(Date.now() / 1000),
      parent_id: parent.id,
    });
    expect(edited.text).toBe(newText);
    expect(edited.edited_on).not.toBeNull();
  });

  test("delete_message works on thread reply", async () => {
    const client = makeClient();
    const parent = await seedMessage(`thread-del-parent-${Date.now()}`);
    const reply = await client.call<MessageOut>("send_message", {
      message: `thread-del-reply-${Date.now()}`,
      mentions: [],
      mentions_usernames: [],
      parent_message: parent.id,
      timestamp: Math.floor(Date.now() / 1000),
      sender_username: "TestUser",
      files: null,
      images: null,
    });

    const result = await client.call<string>("delete_message", {
      message_id: reply.id,
      parent_id: parent.id,
    });
    expect(result).toMatch(/deleted/i);

    const thread = await client.call<GetMessagesOut>("get_messages", {
      parent_message: parent.id,
      limit: 50,
      offset: 0,
      search_term: null,
    });
    const found = thread.messages.find((m) => m.id === reply.id);
    expect(found).toBeTruthy();
    expect(found!.deleted).not.toBeNull();
  });

  test("reactions work on thread replies", async () => {
    const client = makeClient();
    const env = getEnv();
    const parent = await seedMessage(`thread-react-parent-${Date.now()}`);
    const reply = await client.call<MessageOut>("send_message", {
      message: `thread-react-reply-${Date.now()}`,
      mentions: [],
      mentions_usernames: [],
      parent_message: parent.id,
      timestamp: Math.floor(Date.now() / 1000),
      sender_username: "TestUser",
      files: null,
      images: null,
    });

    await client.call("update_reaction", {
      message_id: reply.id,
      emoji: "👍",
      user: env.memberKey,
      add: true,
    });

    const thread = await client.call<GetMessagesOut>("get_messages", {
      parent_message: parent.id,
      limit: 50,
      offset: 0,
      search_term: null,
    });
    const found = thread.messages.find((m) => m.id === reply.id);
    expect(found?.reactions?.["👍"]).toContain(env.memberKey);
  });

  test("get_messages without parent does not include thread replies", async () => {
    const client = makeClient();
    const marker = `thread-isolation-${Date.now()}`;
    const parent = await seedMessage(marker);
    const replyText = `should-not-appear-${Date.now()}`;

    await client.call("send_message", {
      message: replyText,
      mentions: [],
      mentions_usernames: [],
      parent_message: parent.id,
      timestamp: Math.floor(Date.now() / 1000),
      sender_username: "TestUser",
      files: null,
      images: null,
    });

    const mainResult = await client.call<GetMessagesOut>("get_messages", {
      parent_message: null,
      limit: 50,
      offset: 0,
      search_term: replyText,
    });
    // Thread reply should NOT appear in main feed search
    expect(mainResult.messages.every((m) => m.text !== replyText)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. Error Guard Tests
// ─────────────────────────────────────────────────────────────────────────────

test.describe("error guards", () => {
  test.beforeAll(requireEnv);

  test("calling with any executor key still returns results (node does not reject unknown keys)", async () => {
    // The node does not validate the executorPublicKey field — it passes it through
    // to the WASM which uses it for identity tracking but does not error on unknown keys.
    const badClient = makeClient({
      executorPublicKey: "11111111111111111111111111111111",
    });
    const result = await badClient.call<{ messages: unknown[] }>("get_messages", {
      parent_message: null, limit: 1, offset: 0, search_term: null,
    });
    expect(Array.isArray(result.messages)).toBe(true);
  });

  test("edit thread message without parent_id fails gracefully", async () => {
    const client = makeClient();
    const parent = await client.call<MessageOut>("send_message", {
      message: `thread-parent-noid-${Date.now()}`,
      mentions: [], mentions_usernames: [], parent_message: null,
      timestamp: Math.floor(Date.now() / 1000), sender_username: "T",
      files: null, images: null,
    });
    const reply = await client.call<MessageOut>("send_message", {
      message: `reply-noid-${Date.now()}`,
      mentions: [], mentions_usernames: [], parent_message: parent.id,
      timestamp: Math.floor(Date.now() / 1000), sender_username: "T",
      files: null, images: null,
    });
    // Without parent_id, the message won't be found in main feed → error
    const { ok } = await client.tryCall("edit_message", {
      message_id: reply.id,
      new_message: "edited",
      timestamp: Math.floor(Date.now() / 1000),
      parent_id: null,
    });
    // Should fail — reply is not in main messages
    expect(ok).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. Multi-user (2-node) Tests
// Requires scripts/setup-nodes.sh (not dev-node.sh).
// Skipped automatically when E2E_MEMBER_KEY_2 / E2E_NODE_URL_2 are absent.
// ─────────────────────────────────────────────────────────────────────────────

/** Poll `fn` up to `maxMs` ms (250ms intervals) until it returns truthy. */
async function pollUntil<T>(fn: () => Promise<T | null | undefined>, maxMs = 6000): Promise<T> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`pollUntil timed out after ${maxMs}ms`);
}

test.describe("multi-user (2-node)", () => {
  test.beforeAll(async () => {
    if (!twoNodeEnvAvailable()) test.skip();

    // Wait for P2P gossip link to be active before running cross-node tests.
    // Send a probe message from node-1 and wait until node-2 sees it.
    const probe = `p2p-probe-${Date.now()}`;
    await makeClient().call("send_message", {
      message: probe, mentions: [], mentions_usernames: [],
      parent_message: null, timestamp: Math.floor(Date.now() / 1000),
      sender_username: "probe", files: null, images: null,
    });
    await pollUntil(async () => {
      const r = await makeClient2().call<GetMessagesOut>("get_messages", {
        parent_message: null, limit: 20, offset: 0, search_term: probe,
      });
      return r.messages.find((m) => m.text === probe);
    }, 30000);
  });

  // Helper shared across tests in this group
  async function aliceSends(text: string): Promise<MessageOut> {
    return makeClient().call<MessageOut>("send_message", {
      message: text,
      mentions: [],
      mentions_usernames: [],
      parent_message: null,
      timestamp: Math.floor(Date.now() / 1000),
      sender_username: "Alice",
      files: null,
      images: null,
    });
  }

  async function bobSends(text: string): Promise<MessageOut> {
    return makeClient2().call<MessageOut>("send_message", {
      message: text,
      mentions: [],
      mentions_usernames: [],
      parent_message: null,
      timestamp: Math.floor(Date.now() / 1000),
      sender_username: "Bob",
      files: null,
      images: null,
    });
  }

  // ── Profiles ──────────────────────────────────────────────────────────────

  test("Alice and Bob can both set independent profiles", async () => {
    await makeClient().call<string>("set_profile", { username: "Alice", avatar: null });
    await makeClient2().call<string>("set_profile", { username: "Bob", avatar: null });

    const profiles = await makeClient().call<Array<{ identity: string; username: string }>>(
      "get_profiles", {},
    );
    const env = getEnv();
    const alice = profiles.find((p) => p.identity === env.memberKey);
    const bob   = profiles.find((p) => p.identity === env.memberKey2);
    expect(alice?.username).toBe("Alice");
    expect(bob?.username).toBe("Bob");
  });

  // ── Cross-node message visibility ─────────────────────────────────────────

  test("Alice's message is visible to Bob on node-2", async () => {
    const marker = `alice-to-bob-${Date.now()}`;
    await aliceSends(marker);

    // Poll node-2 until the message syncs across
    const found = await pollUntil(async () => {
      const res = await makeClient2().call<GetMessagesOut>("get_messages", {
        parent_message: null, limit: 50, offset: 0, search_term: marker,
      });
      return res.messages.find((m) => m.text === marker);
    }, 15000);

    expect(found).toBeTruthy();
    expect(found!.text).toBe(marker);
  });

  test("Bob's message is visible to Alice on node-1", async () => {
    const marker = `bob-to-alice-${Date.now()}`;
    await bobSends(marker);

    const found = await pollUntil(async () => {
      const res = await makeClient().call<GetMessagesOut>("get_messages", {
        parent_message: null, limit: 50, offset: 0, search_term: marker,
      });
      return res.messages.find((m) => m.text === marker);
    }, 15000);

    expect(found).toBeTruthy();
  });

  // ── Cross-user authorization ───────────────────────────────────────────────

  test("Bob cannot edit Alice's message", async () => {
    const marker = `auth-edit-${Date.now()}`;
    const msg = await aliceSends(marker);

    // Wait for Alice's message to sync to node-2 before Bob tries to edit it
    await pollUntil(async () => {
      const r = await makeClient2().call<GetMessagesOut>("get_messages", {
        parent_message: null, limit: 50, offset: 0, search_term: marker,
      });
      return r.messages.find((m) => m.id === msg.id);
    }, 15000);

    // Bob tries to edit from node-2 with his own JWT — executor_id = Bob's key
    // Alice's message has sender = Alice's key → mismatch → WASM rejects
    const { ok, error } = await makeClient2().tryCall("edit_message", {
      message_id: msg.id,
      new_message: "hacked!",
      timestamp: Math.floor(Date.now() / 1000),
      parent_id: null,
    });

    expect(ok).toBe(false);
    expect(typeof error).toBe("string");
    expect(error!.length).toBeGreaterThan(0);
  });

  test("Bob cannot delete Alice's message", async () => {
    const marker = `auth-del-${Date.now()}`;
    const msg = await aliceSends(marker);

    // Wait for sync to node-2
    await pollUntil(async () => {
      const r = await makeClient2().call<GetMessagesOut>("get_messages", {
        parent_message: null, limit: 50, offset: 0, search_term: marker,
      });
      return r.messages.find((m) => m.id === msg.id);
    }, 15000);

    // Bob deletes from node-2 with his own JWT — should fail
    const { ok, error } = await makeClient2().tryCall("delete_message", {
      message_id: msg.id,
      parent_id: null,
    });

    expect(ok).toBe(false);
    expect(error!.length).toBeGreaterThan(0);
  });

  test("Alice cannot edit Bob's message", async () => {
    const marker = `auth-edit-bob-${Date.now()}`;
    const msg = await bobSends(marker);

    // Wait for node-1 to see Bob's message
    await pollUntil(async () => {
      const r = await makeClient().call<GetMessagesOut>("get_messages", {
        parent_message: null, limit: 50, offset: 0, search_term: marker,
      });
      return r.messages.find((m) => m.id === msg.id);
    }, 15000);

    const { ok } = await makeClient().tryCall("edit_message", {
      message_id: msg.id,
      new_message: "hacked!",
      timestamp: Math.floor(Date.now() / 1000),
      parent_id: null,
    });
    expect(ok).toBe(false);
  });

  test("Alice (admin) can delete Bob's message", async () => {
    const marker = `auth-del-bob-${Date.now()}`;
    const msg = await bobSends(marker);

    await pollUntil(async () => {
      const r = await makeClient().call<GetMessagesOut>("get_messages", {
        parent_message: null, limit: 50, offset: 0, search_term: marker,
      });
      return r.messages.find((m) => m.id === msg.id);
    }, 15000);

    const { ok } = await makeClient().tryCall("delete_message", {
      message_id: msg.id,
      parent_id: null,
    });
    expect(ok).toBe(true);

    // Verify the message shows as deleted
    const after = await makeClient().call<GetMessagesOut>("get_messages", {
      parent_message: null, limit: 50, offset: 0, search_term: null,
    });
    const deleted = after.messages.find((m) => m.id === msg.id);
    expect(deleted?.deleted).toBe(true);
    expect(deleted?.text).toBe("");
  });

  // ── Multi-user reactions ───────────────────────────────────────────────────

  test("Alice and Bob can both react to the same message", async () => {
    const env = getEnv();
    const marker = `multi-react-${Date.now()}`;
    const msg = await aliceSends(marker);

    await makeClient().call("update_reaction", {
      message_id: msg.id, emoji: "👍", user: env.memberKey, add: true,
    });
    await makeClient({
      executorPublicKey: env.memberKey2,
    }).call("update_reaction", {
      message_id: msg.id, emoji: "👍", user: env.memberKey2, add: true,
    });

    const result = await makeClient().call<GetMessagesOut>("get_messages", {
      parent_message: null, limit: 50, offset: 0, search_term: marker,
    });
    const found = result.messages.find((m) => m.id === msg.id);
    const reactors = found?.reactions?.["👍"] ?? [];
    expect(reactors).toContain(env.memberKey);
    expect(reactors).toContain(env.memberKey2);
    expect(new Set(reactors).size).toBe(reactors.length); // no duplicate keys
  });

  test("Alice and Bob can react with different emojis", async () => {
    const env = getEnv();
    const marker = `multi-emoji-${Date.now()}`;
    const msg = await aliceSends(marker);

    await makeClient().call("update_reaction", {
      message_id: msg.id, emoji: "❤️", user: env.memberKey, add: true,
    });
    await makeClient({ executorPublicKey: env.memberKey2 }).call("update_reaction", {
      message_id: msg.id, emoji: "😂", user: env.memberKey2, add: true,
    });

    const result = await makeClient().call<GetMessagesOut>("get_messages", {
      parent_message: null, limit: 50, offset: 0, search_term: marker,
    });
    const found = result.messages.find((m) => m.id === msg.id);
    expect(found?.reactions?.["❤️"]).toContain(env.memberKey);
    expect(found?.reactions?.["😂"]).toContain(env.memberKey2);
  });

  // ── Thread replies across users ────────────────────────────────────────────

  test("Bob can reply to Alice's thread", async () => {
    const parentText = `thread-alice-${Date.now()}`;
    const parent = await aliceSends(parentText);

    const reply = await makeClient2().call<MessageOut>("send_message", {
      message: `bob-reply-${Date.now()}`,
      mentions: [],
      mentions_usernames: [],
      parent_message: parent.id,
      timestamp: Math.floor(Date.now() / 1000),
      sender_username: "Bob",
      files: null,
      images: null,
    });
    expect(typeof reply.id).toBe("string");

    // thread_count on parent should reflect Bob's reply (poll until synced)
    const parentWithCount = await pollUntil(async () => {
      const r = await makeClient().call<GetMessagesOut>("get_messages", {
        parent_message: null, limit: 50, offset: 0, search_term: parentText,
      });
      const p = r.messages.find((m) => m.id === parent.id);
      return p && p.thread_count > 0 ? p : null;
    }, 15000);
    expect(parentWithCount!.thread_count).toBeGreaterThan(0);
  });

  // ── Message ordering across users ─────────────────────────────────────────

  test("messages from both users appear in chronological order", async () => {
    const ts = Math.floor(Date.now() / 1000);
    const tag = `order-${Date.now()}`;

    // Send with explicit increasing timestamps so order is deterministic
    await makeClient().call<MessageOut>("send_message", {
      message: `${tag}-1`, mentions: [], mentions_usernames: [],
      parent_message: null, timestamp: ts,
      sender_username: "Alice", files: null, images: null,
    });
    await makeClient2().call<MessageOut>("send_message", {
      message: `${tag}-2`, mentions: [], mentions_usernames: [],
      parent_message: null, timestamp: ts + 1,
      sender_username: "Bob", files: null, images: null,
    });
    await makeClient().call<MessageOut>("send_message", {
      message: `${tag}-3`, mentions: [], mentions_usernames: [],
      parent_message: null, timestamp: ts + 2,
      sender_username: "Alice", files: null, images: null,
    });

    // Poll until all three are visible on node-1
    const msgs = await pollUntil(async () => {
      const r = await makeClient().call<GetMessagesOut>("get_messages", {
        parent_message: null, limit: 50, offset: 0, search_term: tag,
      });
      return r.messages.length >= 3 ? r.messages : null;
    }, 15000);

    const texts = msgs!.map((m) => m.text);
    const idx1 = texts.indexOf(`${tag}-1`);
    const idx2 = texts.indexOf(`${tag}-2`);
    const idx3 = texts.indexOf(`${tag}-3`);
    expect(idx1).toBeGreaterThanOrEqual(0);
    expect(idx2).toBeGreaterThan(idx1);
    expect(idx3).toBeGreaterThan(idx2);
  });
});
