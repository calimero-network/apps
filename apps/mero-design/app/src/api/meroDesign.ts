/**
 * The MeroDesign contract, typed (no client is generated from a component ABI
 * yet), and the ONE place v1's wire is mapped onto the component's.
 *
 * The screens, the canvas and the batch helpers call methods by their v1 names
 * with v1's argument names (`rpcCall(board, "update_element", { stroke_width,
 * updated_at })`). The component contract takes camelCase method and argument
 * names, and 64-bit integer ARGUMENTS as decimal strings (`"updatedAt":
 * "1727000010000"`). An element is a table record, so its own 64-bit fields
 * (`x`, `y`, `createdAt`, `updatedAt`) are decimal strings both ways;
 * `elementToContract` / `elementFromContract` convert them, and the screens keep
 * v1's numbers. Members, comments and pointers are plain serde structs whose
 * 64-bit fields stay JSON numbers. The paged reads (`getElements`,
 * `getComments`) answer `{ items, next }`; `rpc.ts` follows `next`.
 *
 * `meroDesign.test.ts` asserts the table below is exactly the committed
 * `logic/res/abi.json`: every method, its kind, and its parameter names.
 */

/** How one argument travels: as given, or a 64-bit integer as a decimal string. */
type Wire = "json" | "int64";

export interface MethodSpec {
  /** The ABI's (camelCase) name. */
  name: string;
  /** A call goes through the app's log; a view is answered by a node without writing. */
  kind: "call" | "view";
  /** v1 argument name → its ABI name and how it travels. */
  params: Record<string, readonly [string, Wire]>;
}

const p = (name: string, wire: Wire = "json") => [name, wire] as const;

export const METHODS: Record<string, MethodSpec> = {
  get_board: { name: "getBoard", kind: "view", params: {} },
  update_board: { name: "updateBoard", kind: "call", params: { name: p("name"), description: p("description") } },
  transfer_ownership: { name: "transferOwnership", kind: "call", params: { new_owner: p("newOwner") } },
  grant_editor: { name: "grantEditor", kind: "call", params: { member: p("member") } },
  revoke_editor: { name: "revokeEditor", kind: "call", params: { member: p("member") } },
  get_role: { name: "getRole", kind: "view", params: { member: p("member") } },
  my_role: { name: "myRole", kind: "view", params: {} },
  can_edit: { name: "canEdit", kind: "view", params: {} },
  list_roles: { name: "listRoles", kind: "view", params: {} },
  join: {
    name: "join",
    kind: "call",
    params: { username: p("username"), avatar: p("avatar"), timestamp: p("timestamp", "int64") },
  },
  get_members: { name: "getMembers", kind: "view", params: {} },
  update_member_username: {
    name: "updateMemberUsername",
    kind: "call",
    params: { username: p("username"), timestamp: p("timestamp", "int64") },
  },
  add_element: { name: "addElement", kind: "call", params: { element: p("element") } },
  add_elements: { name: "addElements", kind: "call", params: { elements: p("elements") } },
  update_element: {
    name: "updateElement",
    kind: "call",
    params: {
      id: p("id"),
      x: p("x", "int64"),
      y: p("y", "int64"),
      width: p("width"),
      height: p("height"),
      rotation: p("rotation"),
      fill: p("fill"),
      stroke: p("stroke"),
      stroke_width: p("strokeWidth"),
      opacity: p("opacity"),
      corner_radius: p("cornerRadius"),
      updated_at: p("updatedAt", "int64"),
    },
  },
  update_elements: {
    name: "updateElements",
    kind: "call",
    params: { patches: p("patches"), updated_at: p("updatedAt", "int64") },
  },
  update_element_label: {
    name: "updateElementLabel",
    kind: "call",
    params: { id: p("id"), label: p("label"), updated_at: p("updatedAt", "int64") },
  },
  update_element_labels: {
    name: "updateElementLabels",
    kind: "call",
    params: { labels: p("labels"), updated_at: p("updatedAt", "int64") },
  },
  update_text_style: {
    name: "updateTextStyle",
    kind: "call",
    params: {
      id: p("id"),
      content: p("content"),
      font_family: p("fontFamily"),
      font_size: p("fontSize"),
      bold: p("bold"),
      italic: p("italic"),
      text_align: p("textAlign"),
      vertical_align: p("verticalAlign"),
      updated_at: p("updatedAt", "int64"),
    },
  },
  update_shadow: {
    name: "updateShadow",
    kind: "call",
    params: {
      id: p("id"),
      shadow_color: p("shadowColor"),
      shadow_offset_x: p("shadowOffsetX"),
      shadow_offset_y: p("shadowOffsetY"),
      shadow_blur: p("shadowBlur"),
      updated_at: p("updatedAt", "int64"),
    },
  },
  clear_elements: { name: "clearElements", kind: "call", params: {} },
  clear_comments: { name: "clearComments", kind: "call", params: {} },
  delete_element: { name: "deleteElement", kind: "call", params: { id: p("id") } },
  delete_elements: { name: "deleteElements", kind: "call", params: { ids: p("ids") } },
  get_elements: { name: "getElements", kind: "view", params: { cursor: p("cursor"), limit: p("limit") } },
  get_element: { name: "getElement", kind: "view", params: { id: p("id") } },
  get_elements_by_ids: { name: "getElementsByIds", kind: "view", params: { ids: p("ids") } },
  set_layer_index: {
    name: "setLayerIndex",
    kind: "call",
    params: { id: p("id"), index: p("index"), updated_at: p("updatedAt", "int64") },
  },
  bring_to_front: { name: "bringToFront", kind: "call", params: { id: p("id") } },
  send_to_back: { name: "sendToBack", kind: "call", params: { id: p("id") } },
  add_comment: {
    name: "addComment",
    kind: "call",
    params: {
      id: p("id"),
      x: p("x", "int64"),
      y: p("y", "int64"),
      content: p("content"),
      created_at: p("createdAt", "int64"),
    },
  },
  add_reply: {
    name: "addReply",
    kind: "call",
    params: {
      comment_id: p("commentId"),
      reply_id: p("replyId"),
      content: p("content"),
      created_at: p("createdAt", "int64"),
    },
  },
  delete_reply: {
    name: "deleteReply",
    kind: "call",
    params: { comment_id: p("commentId"), reply_id: p("replyId") },
  },
  delete_comment: { name: "deleteComment", kind: "call", params: { id: p("id") } },
  get_comments: { name: "getComments", kind: "view", params: { cursor: p("cursor"), limit: p("limit") } },
  update_cursor: {
    name: "updateCursor",
    kind: "call",
    params: { x: p("x", "int64"), y: p("y", "int64"), updated_at: p("updatedAt", "int64") },
  },
  get_cursors: { name: "getCursors", kind: "view", params: {} },
};

/** A 64-bit integer argument as the contract takes it: a decimal string (`null` stays `null`). */
function int64(value: unknown, method: string, key: string): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value).toString();
  if (typeof value === "string" && /^-?\d+$/.test(value)) return value;
  throw new Error(`${method}: ${key} must be an integer, got ${JSON.stringify(value)}`);
}

export interface WireRequest {
  name: string;
  kind: "call" | "view";
  args: Record<string, unknown>;
}

/**
 * The component request for a v1 method and arguments: the ABI name, whether
 * it is a call or a view, and the arguments renamed and converted. An argument
 * the method does not take is an error here rather than a `BadArgs` from the
 * node, and an omitted optional one is sent as `null`.
 */
export function toWire(method: string, args: Record<string, unknown>): WireRequest {
  const spec = METHODS[method];
  if (!spec) throw new Error(`MeroDesign has no method ${method}`);
  for (const key of Object.keys(args)) {
    if (!(key in spec.params)) throw new Error(`${method} takes no argument ${key}`);
  }
  const out: Record<string, unknown> = {};
  for (const [v1, [name, wire]] of Object.entries(spec.params)) {
    const value = args[v1];
    out[name] = wire === "int64" ? int64(value, method, v1) : (value ?? null);
  }
  return { name: spec.name, kind: spec.kind, args: out };
}

// ── Elements ─────────────────────────────────────────────────────────────────

/** An element's 64-bit fields: decimal strings on the contract, numbers in the app. */
const ELEMENT_INT64 = ["x", "y", "createdAt", "updatedAt"] as const;

/**
 * An element as `addElement(s)` takes it: its 64-bit fields as decimal strings,
 * and no `blobId` key while an image has no blob yet (the contract takes a
 * blob id or nothing, never `""`).
 */
export function elementToContract<T extends object>(el: T): Record<string, unknown> {
  const out: Record<string, unknown> = { ...(el as Record<string, unknown>) };
  for (const key of ELEMENT_INT64) {
    if (key in out) out[key] = int64(out[key], "element", key);
  }
  const data = out.data as Record<string, unknown> | undefined;
  if (data && typeof data === "object" && "blobId" in data && !data.blobId) {
    const { blobId: _empty, ...rest } = data;
    out.data = rest;
  }
  return out;
}

/** An element as the contract answers it → the app's: 64-bit fields back to numbers. */
export function elementFromContract<T>(el: T): T {
  if (!el || typeof el !== "object") return el;
  const out: Record<string, unknown> = { ...(el as Record<string, unknown>) };
  for (const key of ELEMENT_INT64) {
    const v = out[key];
    if (typeof v === "string" && /^-?\d+$/.test(v)) out[key] = Number(v);
  }
  return out as T;
}

/** One page of a paged read. */
export interface Page<T> {
  items: T[];
  next: string | null;
}
