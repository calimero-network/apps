// Seeds the browser storage a signed-in user with a workspace selected would
// have, from the scene the shooter injected as window.__SHOT_SCENE__.
import { CONTEXTS, ME, NAMESPACE_ID, NAMESPACE_NAME } from "./world";

type Scene = { open?: string; noWorkspace?: boolean; unauthenticated?: boolean };
const scene: Scene = (globalThis as { __SHOT_SCENE__?: Scene }).__SHOT_SCENE__ ?? {};

localStorage.clear();
sessionStorage.clear();

if (!scene.unauthenticated) {
  const exp = Date.now() + 3600_000 * 24;
  // A syntactically valid, unsigned JWT: only its `exp` is ever read client-side.
  const b64 = (o: object) => btoa(JSON.stringify(o)).replace(/=+$/, "");
  const jwt = `${b64({ alg: "none" })}.${b64({ exp: Math.floor(exp / 1000) })}.x`;
  localStorage.setItem("mero-tokens", JSON.stringify({ access_token: jwt, refresh_token: "r", expires_at: exp }));
  localStorage.setItem("mero:node_url", "http://node.mock");
  localStorage.setItem("chat-username", ME.name);
}

if (!scene.noWorkspace && !scene.unauthenticated) {
  sessionStorage.setItem("calimero_group_id", NAMESPACE_ID);
  localStorage.setItem("calimero_group_id", NAMESPACE_ID);
  sessionStorage.setItem("curb_ns_ready", "1");
  localStorage.setItem("calimero_group_member_identities", JSON.stringify({ [NAMESPACE_ID]: ME.accountHex }));
  sessionStorage.setItem("calimero_group_aliases", JSON.stringify({ [NAMESPACE_ID]: NAMESPACE_NAME }));
  const c = CONTEXTS.find((x) => x.key === scene.open);
  if (c) {
    localStorage.setItem(
      "lastSession",
      JSON.stringify({
        type: c.type === "Dm" ? "direct_message" : "channel",
        id: c.contextId,
        contextId: c.contextId,
        name: c.name,
        contextIdentity: c.selfIdentity,
        readOnly: false,
        isSynced: true,
      }),
    );
  }
}

// Answered by the shooter's route for GET {node}/admin-api/identity — the one
// node call the app makes with raw axios rather than through MeroJs.
(window as unknown as { __SHOT_IDENTITY__: unknown }).__SHOT_IDENTITY__ = {
  accountId: ME.accountHex,
  deviceId: null,
};
