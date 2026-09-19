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

import { createAgreement } from './agreements';

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
  /** The workspace new agreements are created in. Null outside one. */
  workspaceId: string | null,
): MeroAppLike {
  return {
    async execute(contextId, method, args) {
      // ⚠️ The executor is NOT passed. mero-js resolves the caller's own
      // identity in the context (core #3960 answers context identities for the
      // CALLER rather than the node), and the old SDK's habit of supplying one
      // is what `check-admin-wire.py` flags as a rejected body key.
      return mero.rpc.execute({ contextId, method, argsJson: args });
    },

    async createContext(_applicationId, initParams) {
      // ⚠️ AN AGREEMENT IS A SUBGROUP AND ITS CONTEXT, NOT A BARE CONTEXT.
      //
      // Core requires the binding: `CreateContextRequest` in
      // `crates/server/primitives/src/admin/mod.rs` declares
      //
      //     pub group_id: String,
      //
      // with no `Option` and no `#[serde(default)]`. The path this replaces
      // posted `{applicationId, initializationParams, protocol}` — no group at
      // all, plus `protocol`, which core removed — and every admin body is
      // `deny_unknown_fields`, so it was refused twice over. Mero Sign could
      // not create an agreement on an rc.41 node.
      //
      // `createAgreement` supplies the binding and everything that has to come
      // with it: a named subgroup, OPEN visibility so invited signers can reach
      // it, and `init`'s real two parameters. See `lib/agreements`.
      if (!applicationId) {
        throw new Error(
          'Cannot create an agreement: no application id resolved for Mero Sign on this node.',
        );
      }
      if (!workspaceId) {
        throw new Error(
          'Cannot create an agreement outside a workspace. Open or create one first.',
        );
      }
      const params = (initParams ?? {}) as {
        context_name?: string;
        is_private?: boolean;
      };
      return createAgreement(mero.admin, {
        applicationId,
        namespaceId: workspaceId,
        name: (params.context_name ?? '').trim() || 'Agreement',
        isPrivate: params.is_private ?? false,
      });
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
