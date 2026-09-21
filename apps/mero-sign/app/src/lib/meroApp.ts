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

import {
  createAgreement,
  createPersonalContext,
  ensurePersonalWorkspace,
} from './agreements';
import { APP_PACKAGE, resolveApplicationId } from './appId';

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
  ): Promise<CreatedContext>;
  fetchContexts(): Promise<unknown>;
  joinContext(props: { invitationPayload: string }): Promise<unknown>;
  inviteToContext(props: {
    contextId: string;
    inviterId: string;
    inviteeId: string;
  }): Promise<unknown>;
  verifyContext(props: { contextId: string }): Promise<{ joined: boolean }>;
}

/**
 * What `createContext` resolves to.
 *
 * ⚠️ `executorId` IS NOT DECORATION. `AgreementService.createAgreement` reads
 * `contextData.executorId` and writes it into the agreement's `memberPublicKey`,
 * `privateIdentity` and `sharedIdentity` — so omitting it does not fail, it
 * produces an agreement row whose every identity field is `undefined` and whose
 * card opens a screen that cannot say who you are. mero-js calls the same value
 * `memberPublicKey`; both spellings are returned because the two layers each
 * have their own.
 */
export interface CreatedContext {
  contextId: string;
  memberPublicKey: string;
  executorId: string;
  applicationId: string;
}

export function meroApp(
  mero: MeroJs,
  /** The workspace new agreements are created in. Null outside one. */
  workspaceId: string | null,
): MeroAppLike {
  /**
   * This app's id on THIS node, resolved lazily and cached by `lib/appId`.
   *
   * ⚠️ Lazy, not a parameter. An ApplicationId is `hash(package, signer)` and
   * therefore per-install, so the only thing that can answer "which installed
   * application is Mero Sign" is the node — and it can only be asked once
   * there is a connection, which is after `useCalimero()` has already had to
   * return an `app`. Taking it as an argument is what left it hardcoded to
   * `null`, and a null id meant every `createContext` threw before it reached
   * the wire.
   *
   * `mero.admin.listApplications()` is called directly rather than through
   * `lib/node`'s `apiClient`: that module re-exports `useCalimero`, which
   * imports this one, and the cycle is avoidable for the cost of adapting one
   * result shape.
   */
  async function requireApplicationId(): Promise<string> {
    const id = await resolveApplicationId(async () => {
      try {
        return { data: await mero.admin.listApplications() };
      } catch (error) {
        return {
          error: {
            message: error instanceof Error ? error.message : String(error),
          },
        };
      }
    });
    if (!id) {
      throw new Error(
        `${APP_PACKAGE} is not installed on this node, so there is no ` +
          'application to create a context for. Install it from the registry ' +
          'and try again.',
      );
    }
    return id;
  }

  return {
    async execute(contextId, method, args) {
      // ⚠️ A CONTEXT ID, NOT A CONTEXT RECORD. Every caller on the private
      // surface used to hand over the whole `DefaultContextInfo`, and the
      // node answers that with `ParseError: invalid type: map, expected a hex
      // encoded hash` — from inside a `catch` that falls back, so the
      // signature library and the local agreement registry failed in silence.
      // Caught here so the next one says what it did rather than what the
      // node made of it.
      if (typeof contextId !== 'string') {
        throw new Error(
          'execute() takes a context id, not a context record — pass ' +
            '`ctx.contextId`.',
        );
      }
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
      const params = (initParams ?? {}) as {
        context_name?: string;
        is_private?: boolean;
      };
      const applicationId = await requireApplicationId();

      // ⚠️ THE PRIVATE CONTEXT NEEDS A GROUP TOO. `is_private` is a flag on the
      // CONTRACT, not an exemption from `group_id`, and this app creates one
      // per node for the signature library. It goes in a namespace of its own —
      // never a workspace, which is a thing you invite people into. See the
      // personal-workspace note in `lib/agreements`.
      if (params.is_private) {
        const namespaceId = await ensurePersonalWorkspace(
          mero.admin,
          applicationId,
        );
        const created = await createPersonalContext(mero.admin, {
          applicationId,
          namespaceId,
          name: params.context_name,
        });
        return {
          contextId: created.contextId,
          memberPublicKey: created.memberPublicKey,
          executorId: created.memberPublicKey,
          applicationId,
        };
      }

      if (!workspaceId) {
        throw new Error(
          'Cannot create an agreement outside a workspace. Open or create one first.',
        );
      }

      const created = await createAgreement(mero.admin, {
        applicationId,
        namespaceId: workspaceId,
        name: (params.context_name ?? '').trim() || 'Agreement',
        isPrivate: false,
      });
      return {
        contextId: created.contextId,
        memberPublicKey: created.memberPublicKey,
        executorId: created.memberPublicKey,
        applicationId,
      };
    },

    async fetchContexts() {
      return mero.admin.getContexts();
    },

    async joinContext(props) {
      return mero.admin.joinContext(props.invitationPayload);
    },

    async inviteToContext(props) {
      // ⚠️ THERE IS NO TARGETED PER-CONTEXT INVITATION AT rc.41, and this call
      // was wrong twice over. `createGroupInvitation` takes a GROUP id — it
      // was handed a CONTEXT id, which the node cannot resolve and answers as
      // a bare 500. And it has no invitee field at all
      // (`{expirationTimestamp, recursive, admitters}`), so even with the
      // right id it would have minted an OPEN invitation while the screen
      // above it promised "a payload only they can redeem".
      //
      // Failing in words rather than as a 500: the workspace link is the
      // invitation model, and `addParticipant` is how a known identity is
      // given a role once they are in.
      void props;
      throw new Error(
        'Per-person invitations are not available. Share the workspace ' +
          'invitation link instead — it admits them to the workspace, and ' +
          'every agreement in it.',
      );
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
