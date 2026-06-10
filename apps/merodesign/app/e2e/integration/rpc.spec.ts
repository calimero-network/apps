/**
 * Integration tests — require a real Calimero node.
 *
 * Set env vars: INTEGRATION_NODE_URL, INTEGRATION_ACCESS_TOKEN, INTEGRATION_CONTEXT_ID
 * Run: npx playwright test --project=integration
 */
import { test, expect, request } from "@playwright/test";

const NODE_URL = process.env.INTEGRATION_NODE_URL ?? "http://localhost:2430";
const TOKEN    = process.env.INTEGRATION_ACCESS_TOKEN ?? "";
const CTX_ID   = process.env.INTEGRATION_CONTEXT_ID ?? "";

test.skip(!TOKEN || !CTX_ID, "INTEGRATION_ACCESS_TOKEN and INTEGRATION_CONTEXT_ID must be set");

async function rpc<T>(method: string, args: Record<string, unknown>): Promise<T> {
  const ctx = await request.newContext();
  const res = await ctx.post(`${NODE_URL}/jsonrpc`, {
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    data: {
      jsonrpc: "2.0",
      id: 1,
      method: "execute",
      params: { contextId: CTX_ID, method, argsJson: args },
    },
  });
  const body = await res.json();
  if (body.error) throw new Error(JSON.stringify(body.error));
  if (!body.result?.output?.length) return null as T;
  const text = Buffer.from(body.result.output).toString("utf8");
  return JSON.parse(text) as T;
}

// ── Element CRUD ──────────────────────────────────────────────────────────────

test.describe("Element CRUD", () => {
  let elementId: string;

  test("add_element with lowercase kind succeeds", async () => {
    const id = `test-${Date.now()}`;
    elementId = id;
    const element = {
      id, data: { kind: "rect" },
      x: 10, y: 20, width: 100, height: 80,
      rotation: 0, fill: "#ff0000", stroke: "transparent",
      stroke_width: 0, opacity: 100, layer_index: 0,
      created_by: "integration-test", created_at: Date.now(), updated_at: Date.now(),
      shadow_color: null, shadow_offset_x: null, shadow_offset_y: null, shadow_blur: null,
      label: null,
    };
    const result = await rpc<string>("add_element", { element });
    expect(result).toBe(id);
  });

  test("get_elements returns the added element", async () => {
    const elements = await rpc<{ id: string; data: { kind: string } }[]>("get_elements", {});
    expect(Array.isArray(elements)).toBe(true);
    const el = elements?.find((e) => e.id === elementId);
    expect(el).toBeDefined();
    expect(el?.data.kind).toBe("rect");
  });

  test("get_element returns the specific element", async () => {
    const el = await rpc<{ id: string; data: { kind: string } }>("get_element", { id: elementId });
    expect(el).toBeDefined();
    expect(el?.id).toBe(elementId);
    expect(el?.data.kind).toBe("rect");
  });

  test("update_element changes position", async () => {
    const updatedAt = Date.now();
    await rpc("update_element", {
      id: elementId, x: 50, y: 60, width: null, height: null,
      rotation: null, fill: null, stroke: null,
      stroke_width: null, opacity: null, updated_at: updatedAt,
    });
    const el = await rpc<{ x: number; y: number }>("get_element", { id: elementId });
    expect(el?.x).toBe(50);
    expect(el?.y).toBe(60);
  });

  test("add_element with circle kind succeeds", async () => {
    const id = `circle-${Date.now()}`;
    const element = {
      id, data: { kind: "circle" },
      x: 0, y: 0, width: 50, height: 50,
      rotation: 0, fill: "#0000ff", stroke: "transparent",
      stroke_width: 0, opacity: 100, layer_index: 1,
      created_by: "integration-test", created_at: Date.now(), updated_at: Date.now(),
      shadow_color: null, shadow_offset_x: null, shadow_offset_y: null, shadow_blur: null,
      label: null,
    };
    const result = await rpc<string>("add_element", { element });
    expect(result).toBe(id);
    // Cleanup
    await rpc("delete_element", { id }).catch(() => {});
  });

  test("add_element with PascalCase kind fails (contract rejects it)", async () => {
    const id = `bad-${Date.now()}`;
    const element = {
      id, data: { kind: "Rect" },
      x: 0, y: 0, width: 50, height: 50,
      rotation: 0, fill: "#fff", stroke: "transparent",
      stroke_width: 0, opacity: 100, layer_index: 0,
      created_by: "integration-test", created_at: Date.now(), updated_at: Date.now(),
      shadow_color: null, shadow_offset_x: null, shadow_offset_y: null, shadow_blur: null,
      label: null,
    };
    await expect(rpc("add_element", { element })).rejects.toThrow(/unknown variant/i);
  });

  test("delete_element removes it", async () => {
    await rpc("delete_element", { id: elementId });
    const el = await rpc<null>("get_element", { id: elementId });
    expect(el).toBeNull();
  });
});

// ── Member / username ─────────────────────────────────────────────────────────

test.describe("Member username", () => {
  // The member id is derived server-side from the signer (env::executor_id),
  // not client-supplied — so we capture it from the first join.
  let myId = "";

  test("join registers a member with username", async () => {
    await rpc("join", {
      username: "IntegrationUser",
      avatar: null,
      timestamp: Date.now(),
    });
    const members = await rpc<{ id: string; username: string }[]>("get_members", {});
    const m = members?.find((m) => m.username === "IntegrationUser");
    expect(m).toBeDefined();
    myId = m!.id;
  });

  test("update_member_username changes the caller's own display name", async () => {
    await rpc("update_member_username", { username: "Renamed", timestamp: Date.now() });
    const members = await rpc<{ id: string; username: string }[]>("get_members", {});
    const m = members?.find((m) => m.id === myId);
    expect(m?.username).toBe("Renamed");
  });

  test("join is idempotent — second call does not duplicate member", async () => {
    const before = await rpc<{ id: string }[]>("get_members", {});
    const countBefore = before?.filter((m) => m.id === myId).length ?? 0;
    await rpc("join", { username: "Again", avatar: null, timestamp: Date.now() });
    const after = await rpc<{ id: string }[]>("get_members", {});
    const countAfter = after?.filter((m) => m.id === myId).length ?? 0;
    expect(countAfter).toBe(countBefore);
  });
});

// ── Comments ──────────────────────────────────────────────────────────────────

test.describe("Comments", () => {
  let commentId: string;

  test("add_comment stores comment text safely", async () => {
    commentId = `comment-${Date.now()}`;
    const xssPayload = '<script>alert("xss")</script>';
    await rpc("add_comment", {
      id: commentId,
      x: 100, y: 200,
      content: xssPayload,
      author: "attacker",
      created_at: Date.now(),
    });
    const comments = await rpc<{ id: string; content: string }[]>("get_comments", {});
    const c = comments?.find((c) => c.id === commentId);
    // WASM stores raw text — no HTML processing at storage layer
    expect(c?.content).toBe(xssPayload);
  });

  test("add_reply stores reply text", async () => {
    const replyId = `reply-${Date.now()}`;
    await rpc("add_reply", {
      comment_id: commentId,
      reply_id: replyId,
      content: "A reply",
      author: "user2",
      created_at: Date.now(),
    });
    const comments = await rpc<{ id: string; replies: { id: string; content: string }[] }[]>("get_comments", {});
    const c = comments?.find((c) => c.id === commentId);
    const r = c?.replies.find((r) => r.id === replyId);
    expect(r?.content).toBe("A reply");
  });

  test("delete_comment removes it", async () => {
    await rpc("delete_comment", { id: commentId });
    const comments = await rpc<{ id: string }[]>("get_comments", {});
    expect(comments?.find((c) => c.id === commentId)).toBeUndefined();
  });
});

// ── Cursor ────────────────────────────────────────────────────────────────────

test.describe("Cursor tracking", () => {
  // identity is derived from the signer; a single node owns exactly one cursor
  // entry, so we match on the position we just wrote.
  test("update_cursor stores position", async () => {
    await rpc("update_cursor", { x: 300, y: 400, updated_at: Date.now() });
    const cursors = await rpc<{ identity: string; x: number; y: number }[]>("get_cursors", {});
    const c = cursors?.find((c) => c.x === 300 && c.y === 400);
    expect(c).toBeDefined();
    expect(c?.identity).toBeTruthy();
  });

  test("cursor response uses camelCase updatedAt", async () => {
    const now = Date.now();
    await rpc("update_cursor", { x: 11, y: 22, updated_at: now });
    const cursors = await rpc<Record<string, unknown>[]>("get_cursors", {});
    const c = cursors?.find((c) => c.x === 11 && c.y === 22);
    // With rename_all = "camelCase", the field should be updatedAt
    expect(c?.updatedAt).toBeDefined();
    expect(c?.updated_at).toBeUndefined();
  });
});

// ── Text alignment ────────────────────────────────────────────────────────────

test.describe("Text alignment", () => {
  let textId: string;

  test("add text element with default alignment", async () => {
    textId = `text-align-${Date.now()}`;
    const element = {
      id: textId,
      data: { kind: "text", content: "Hello", font_size: 24, font_family: "sans-serif", bold: false, italic: false },
      x: 0, y: 0, width: 200, height: 40,
      rotation: 0, fill: "#000", stroke: "transparent",
      stroke_width: 0, opacity: 100, layer_index: 0,
      created_by: "integration-test", created_at: Date.now(), updated_at: Date.now(),
      shadow_color: null, shadow_offset_x: null, shadow_offset_y: null, shadow_blur: null,
      label: null,
    };
    const result = await rpc<string>("add_element", { element });
    expect(result).toBe(textId);
  });

  test("update_text_style sets text_align to center", async () => {
    const updatedAt = Date.now();
    await rpc("update_text_style", {
      id: textId,
      content: null, font_family: null, font_size: null,
      bold: null, italic: null,
      text_align: "center", vertical_align: null,
      updated_at: updatedAt,
    });
    const el = await rpc<{ data: { text_align?: string } }>("get_element", { id: textId });
    expect(el?.data.text_align).toBe("center");
  });

  test("update_text_style sets vertical_align to bottom", async () => {
    const updatedAt = Date.now();
    await rpc("update_text_style", {
      id: textId,
      content: null, font_family: null, font_size: null,
      bold: null, italic: null,
      text_align: null, vertical_align: "bottom",
      updated_at: updatedAt,
    });
    const el = await rpc<{ data: { vertical_align?: string } }>("get_element", { id: textId });
    expect(el?.data.vertical_align).toBe("bottom");
  });

  test("update_text_style with both alignments", async () => {
    const updatedAt = Date.now();
    await rpc("update_text_style", {
      id: textId,
      content: null, font_family: null, font_size: null,
      bold: null, italic: null,
      text_align: "right", vertical_align: "middle",
      updated_at: updatedAt,
    });
    const el = await rpc<{ data: { text_align?: string; vertical_align?: string } }>("get_element", { id: textId });
    expect(el?.data.text_align).toBe("right");
    expect(el?.data.vertical_align).toBe("middle");
  });

  test("cleanup: delete text alignment element", async () => {
    await rpc("delete_element", { id: textId }).catch(() => {});
  });
});

// ── clear_elements / clear_comments ──────────────────────────────────────────

test.describe("Import/Export: clear methods", () => {
  test("clear_elements removes all elements", async () => {
    // Add a test element first
    const tempId = `clear-test-${Date.now()}`;
    const element = {
      id: tempId,
      data: { kind: "rect" },
      x: 0, y: 0, width: 50, height: 50,
      rotation: 0, fill: "#fff", stroke: "transparent",
      stroke_width: 0, opacity: 100, layer_index: 0,
      created_by: "test", created_at: Date.now(), updated_at: Date.now(),
      shadow_color: null, shadow_offset_x: null, shadow_offset_y: null, shadow_blur: null,
      label: null,
    };
    await rpc("add_element", { element });
    const before = await rpc<{ id: string }[]>("get_elements", {});
    expect(before?.some((e) => e.id === tempId)).toBe(true);

    await rpc("clear_elements", {});

    const after = await rpc<{ id: string }[]>("get_elements", {});
    expect(after ?? []).toHaveLength(0);
  });

  test("clear_comments removes all comments", async () => {
    const tempCommentId = `clear-comment-${Date.now()}`;
    await rpc("add_comment", {
      id: tempCommentId,
      x: 10, y: 20,
      content: "temp",
      author: "test",
      created_at: Date.now(),
    });
    const before = await rpc<{ id: string }[]>("get_comments", {});
    expect(before?.some((c) => c.id === tempCommentId)).toBe(true);

    await rpc("clear_comments", {});

    const after = await rpc<{ id: string }[]>("get_comments", {});
    expect(after ?? []).toHaveLength(0);
  });

  test("export → import round-trip restores element count", async () => {
    // Start clean
    await rpc("clear_elements", {});

    // Add 3 elements
    const ids = [`rt-1-${Date.now()}`, `rt-2-${Date.now()}`, `rt-3-${Date.now()}`];
    for (const id of ids) {
      await rpc("add_element", {
        element: {
          id, data: { kind: "rect" },
          x: 0, y: 0, width: 40, height: 40,
          rotation: 0, fill: "#aaa", stroke: "transparent",
          stroke_width: 0, opacity: 100, layer_index: 0,
          created_by: "test", created_at: Date.now(), updated_at: Date.now(),
          shadow_color: null, shadow_offset_x: null, shadow_offset_y: null, shadow_blur: null,
          label: null,
        },
      });
    }

    // Export
    const exported = await rpc<unknown[]>("get_elements", {});
    expect(exported).toHaveLength(3);

    // Clear and re-import
    await rpc("clear_elements", {});
    for (const el of exported ?? []) {
      await rpc("add_element", { element: el });
    }

    // Verify restored
    const restored = await rpc<unknown[]>("get_elements", {});
    expect(restored).toHaveLength(3);

    // Cleanup
    await rpc("clear_elements", {});
  });
});
