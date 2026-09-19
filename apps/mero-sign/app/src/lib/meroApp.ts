/**
 * The `app` object the data layer expects, backed by mero-js.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * Mero Sign was the last app on `@calimero-network/calimero-client`. That SDK
 * ships its OWN connect screen — `SetupModal`, "Select your Calimero node type
 * to continue / Local / Remote / Using default local node:
 * http://node1.127.0.0.1.nip.io" — hardcoded, with no prop that removes it. It
 * is what `useCalimero().login()` opens, so every attempt to fix the app's
 * login by improving the screen AROUND it left that screen exactly where it
 * was. The only way to replace it is to stop using that SDK's provider, which
 * means `useCalimero().app` has to come from somewhere else.
 *
 * ── Why an adapter and not a rewrite ────────────────────────────────────────
 *
 * `ClientApiDataSource` takes its client as `app?: any` and every call site
 * reads `this.app.execute(...)` inside `try { if (this.app) … } catch { … }`.
 * It is duck-typed, so the data layer does not care what supplies those six
 * methods — and that includes `sign_document`'s path, which must not be
 * touched to change a login screen.
 *
 * So this implements exactly the surface the data layer uses, on `mero.admin`
 * and `mero.rpc`, and nothing else. The migration is then a provider swap plus
 * this file, rather than 13 call sites through the signing code.
 */
import type { MeroJs } from '@calimero-network/mero-js';

/** The six methods `ClientApiDataSource` / `NodeApiDataSource` actually call. */
export interface MeroAppLike {
  execute(
    contextId: string,
    method: string,
    args: Record<string, unknown>,
  ): Promise<unknown>;
  createContext(
    applicationId: string | undefined,
    initParams: Record<string, unknown>,
  ): Promise<unknown>;
  fetchContexts(): Promise<unknown>;
  joinContext(props: { invitationPayload: string }): Promise<unknown>;
  inviteToContext(props: {
    contextId: string;
    inviterId: string;
    inviteeId: string;
  }): Promise<unknown>;
  verifyContext(props: { contextId: string }): Promise<{ joined: boolean }>;
}

export function meroApp(
  mero: MeroJs,
  applicationId: string | null,
): MeroAppLike {
  return {
    async execute(contextId, method, args) {
      // ⚠️ The executor is NOT passed. mero-js resolves the caller's own
      // identity in the context (core #3960 answers context identities for the
      // CALLER rather than the node), and the old SDK's habit of supplying one
      // is what `check-admin-wire.py` flags as a rejected body key.
      return mero.rpc.execute({ contextId, method, argsJson: args });
    },

    async createContext() {
      // ⚠️ DELIBERATELY NOT IMPLEMENTED, AND THIS IS NOT A REGRESSION.
      //
      // Core requires a group binding. `CreateContextRequest` in
      // `crates/server/primitives/src/admin/mod.rs` declares
      //
      //     pub group_id: String,
      //
      // with no `Option` and no `#[serde(default)]` — a context belongs to a
      // namespace or a subgroup, always.
      //
      // The path this replaces sent `{ applicationId, initializationParams,
      // protocol }`: no `group_id` at all, plus `protocol`, which core removed.
      // Every admin body is `deny_unknown_fields`, so that request is rejected
      // twice over. Mero Sign has not been able to create an agreement on an
      // rc.41 node since the fleet bump, and this adapter cannot paper over it
      // — the app has no namespace to bind a context to, because it was built
      // on "one agreement is one context, no namespaces".
      //
      // Giving it one is a change to this app's context and invitation model,
      // not to its login, so it does not belong in this PR.
      throw new Error(
        'Creating an agreement needs a namespace to bind the context to. ' +
          'Mero Sign has no namespace model yet — see the note in lib/meroApp.',
      );
    },

    async fetchContexts() {
      return mero.admin.getContexts();
    },

    async joinContext(props) {
      return mero.admin.joinContext(props.invitationPayload);
    },

    async inviteToContext(props) {
      return mero.admin.createGroupInvitation(props.contextId, {});
    },

    async verifyContext(props) {
      // "Do I hold an identity here?" — not "does this context exist". The old
      // SDK answered the second and the callers read it as the first.
      const { identities } = await mero.admin
        .getContextIdentitiesOwned(props.contextId)
        .catch(() => ({ identities: [] as string[] }));
      return { joined: identities.length > 0 };
    },
  };
}
