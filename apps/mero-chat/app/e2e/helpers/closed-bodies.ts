import type { Request } from "@playwright/test";

/**
 * The request keys core's admin API ACCEPTS, per route, copied from the
 * `deny_unknown_fields` structs in core `crates/server/primitives/src/admin/mod.rs`.
 *
 * Every mock in this suite used to answer any POST with a 200, so a body core
 * refuses — `upgradePolicy` on create-namespace was one — sailed through here
 * and failed on the first real screen. A mock that is looser than the server
 * proves nothing about the wire; this one refuses what core refuses.
 *
 * When core adds or removes a field, update the set here from that file.
 */
const CLOSED_BODIES: Array<{ method: string; path: RegExp; keys: string[] }> = [
  // CreateNamespaceApiRequest (`bytecodeId` is a serde alias of `appKey`)
  { method: "POST", path: /\/admin-api\/namespaces$/, keys: ["applicationId", "name", "appKey", "bytecodeId"] },
  // CreateGroupInvitationApiRequest
  { method: "POST", path: /\/admin-api\/namespaces\/[^/]+\/invite$/, keys: ["expirationTimestamp", "recursive"] },
  // JoinGroupApiRequest
  { method: "POST", path: /\/admin-api\/namespaces\/[^/]+\/join$/, keys: ["invitation", "groupName"] },
  // UpgradeGroupApiRequest
  { method: "POST", path: /\/admin-api\/groups\/[^/]+\/upgrade$/, keys: ["targetApplicationId", "cascade", "forceCodeOnly"] },
  // ReparentGroupApiRequest
  { method: "POST", path: /\/admin-api\/groups\/[^/]+\/reparent$/, keys: ["newParentId"] },
  // SetDefaultCapabilitiesApiRequest
  { method: "PUT", path: /\/admin-api\/groups\/[^/]+\/settings\/default-capabilities$/, keys: ["defaultCapabilities"] },
];

/**
 * Core's refusal for `req`, worded as core words it — or `null` when the body
 * is one core would accept (or the route is not one we track).
 */
export function closedBodyRefusal(req: Request): string | null {
  const url = new URL(req.url());
  const rule = CLOSED_BODIES.find(
    (r) => r.method === req.method() && r.path.test(url.pathname),
  );
  if (!rule) return null;
  let body: unknown;
  try {
    body = req.postDataJSON();
  } catch {
    return "Invalid JSON data: body is not JSON";
  }
  if (!body || typeof body !== "object") return null;
  const unknown = Object.keys(body).find((k) => !rule.keys.includes(k));
  if (!unknown) return null;
  return (
    "Invalid JSON data: Failed to deserialize the JSON body into the target type: " +
    `${unknown}: unknown field \`${unknown}\`, expected one of ` +
    rule.keys.map((k) => `\`${k}\``).join(", ")
  );
}
