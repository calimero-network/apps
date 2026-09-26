// Pure helpers for per-spec-file workspace isolation. Kept dependency-free
// (no Playwright import) so they run under `node --test` directly. The
// stateful orchestration (fetch to the node admin-api, memoization) lives in
// helpers.ts; only the parsing/formatting lives here.

/**
 * Build the auth-callback URL hash the app parses on boot. When `injection` is
 * given, `context_id` + `context_identity` pin the app to a specific context
 * (parseAuthCallback reads those exact param names; useWorkspace prefers the
 * callback context over namespace discovery).
 *
 * @param {{ accessToken: string, refreshToken: string, nodeUrl: string, appId: string }} fields
 * @param {{ contextId: string, contextIdentity: string } | null} [injection]
 * @returns {string}
 */
export function buildAuthHash(fields, injection) {
  const params = {
    access_token: fields.accessToken,
    refresh_token: fields.refreshToken,
    node_url: fields.nodeUrl,
    application_id: fields.appId,
  };
  if (injection) {
    params.context_id = injection.contextId;
    params.context_identity = injection.contextIdentity;
  }
  return new URLSearchParams(params).toString();
}

/**
 * Pull the invitation payload out of a create-namespace-invitation response.
 * Recursive invitations come back as `{ invitations: [{ invitation, ... }] }`;
 * non-recursive as `{ invitation }`.
 *
 * @param {any} resp
 * @returns {unknown}
 */
export function extractInvitation(resp) {
  if (resp && Array.isArray(resp.invitations) && resp.invitations.length > 0) {
    return resp.invitations[0].invitation;
  }
  if (resp && resp.invitation !== undefined) return resp.invitation;
  throw new Error('invitation response missing invitation payload');
}
