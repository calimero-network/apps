import { AppError, type CalimeroClient } from "@calimero-network/mero-js";
import { describeError } from "@calimero-apps/connect";

import abi from "../../../logic/res/abi.json";

/**
 * The document contract, called the way the screens called v1.
 *
 * The screens name methods and arguments as v1 did (`update_layer`,
 * `{ updated_at }`, numbers for clocks). The component ABI names them in
 * camelCase, takes `u64`/`i64` arguments as decimal strings, and tells views
 * from calls. This module is the one place that translates, from the committed
 * `logic/res/abi.json`, so a contract change shows up in its test
 * (`pixart.test.ts`) rather than as a refused call.
 *
 * Answers need no translation: every integer the contract answers is inside a
 * record the contract keeps as v1 did (JSON numbers, camelCase fields).
 */

/** The package production instances come from. */
export const PACKAGE = "com.calimero.mero-pixart";

/** v1's method names, and the component method each one is. */
export const V1_METHODS = {
  get_document: "getDocument",
  update_document: "updateDocument",
  transfer_ownership: "transferOwnership",
  grant_editor: "grantEditor",
  revoke_editor: "revokeEditor",
  get_role: "getRole",
  my_role: "myRole",
  can_edit: "canEdit",
  list_roles: "listRoles",
  join: "join",
  get_members: "getMembers",
  update_member_username: "updateMemberUsername",
  add_layer: "addLayer",
  update_layer: "updateLayer",
  update_transform: "updateTransform",
  move_layers: "moveLayers",
  update_layer_content: "updateLayerContent",
  update_layer_mask: "updateLayerMask",
  update_adjustments: "updateAdjustments",
  update_text: "updateText",
  delete_layer: "deleteLayer",
  get_layers: "getLayers",
  get_layer: "getLayer",
  move_layer: "moveLayer",
  reorder_layers: "reorderLayers",
  bring_to_front: "bringToFront",
  send_to_back: "sendToBack",
  clear_layers: "clearLayers",
  update_cursor: "updateCursor",
  get_cursors: "getCursors",
} as const;

export type V1Method = keyof typeof V1_METHODS;

interface AbiMethod {
  kind: string;
  params: [string, string][];
}

const METHODS = (abi as unknown as { methods: Record<string, AbiMethod> }).methods;

/** Integer types that travel as decimal strings (D20). */
const STRING_INTS = new Set(["u64", "i64", "option<u64>", "option<i64>"]);

const camel = (name: string) => name.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());

/** The component method a v1 name (or an already camelCase name) is. */
export function methodOf(name: string): string {
  return (V1_METHODS as Record<string, string>)[name] ?? camel(name);
}

/** `args` as the component method takes them: camelCase keys, 64-bit integers as strings. */
export function toWire(method: string, args: Record<string, unknown> = {}): Record<string, unknown> {
  const types = new Map((METHODS[method]?.params ?? []).map(([n, t]) => [n, t]));
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (value === undefined) continue;
    const name = camel(key);
    const type = types.get(name);
    out[name] =
      type && STRING_INTS.has(type) && typeof value === "number" ? String(Math.trunc(value)) : value;
  }
  return out;
}

/** Whether `method` is a view (read from any replica, not logged). */
export function isView(method: string): boolean {
  return METHODS[method]?.kind === "view";
}

/** Call or view `name` (v1 or component name) on the document `app`. */
export async function invoke<T>(
  client: Pick<CalimeroClient, "call" | "view">,
  app: string,
  name: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  const method = methodOf(name);
  const wire = toWire(method, args);
  try {
    const res = isView(method) ? await client.view(app, method, wire) : await client.call(app, method, wire);
    return res.result as T;
  } catch (err) {
    throw Object.assign(new Error(messageOf(err)), { cause: err });
  }
}

/** One line for the UI, in v1's words where v1 had them. */
export function messageOf(error: unknown): string {
  const e = error as { appCode?: unknown; fields?: Record<string, unknown> } | null;
  if (error instanceof AppError || typeof e?.appCode === "string") {
    const code = String(e?.appCode);
    const fields = e?.fields ?? {};
    switch (code) {
      case "ViewOnly":
        return "view-only: editor or admin access is required to modify this document";
      case "OwnerOnly":
        return "only the document owner can do that";
      case "Invalid":
        return String(fields.message ?? "invalid input");
      // `rpcWithFallback` (api/compat) reads this as a missing method.
      case "UnknownMethod":
        return "method not found";
      default:
        return describeError(error);
    }
  }
  return describeError(error);
}
