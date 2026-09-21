import type {
  CreateContextProps,
  CreateContextResponse,
  InviteToContextProps,
  JoinContextProps,
  JoinContextResponse,
  NodeApi,
  VerifyContextProps,
  VerifyContextResponse,
} from '../nodeApi';
import { apiClient } from '../../lib/node';
import { APP_PACKAGE, resolveApplicationId } from '../../lib/appId';

export class ContextApiDataSource implements NodeApi {
  private app: any;

  constructor(app: any) {
    this.app = app;
  }

  async createContext(
    props: CreateContextProps,
  ): Promise<{ data?: CreateContextResponse; error?: any }> {
    try {
      if (this.app) {
        const initParams = {
          is_private: props.is_private,
          context_name: props.context_name,
        };

        const result = await this.app.createContext(undefined, initParams);

        return { data: result, error: null };
      }
    } catch (error) {
      // ⚠️ THE REAL ERROR IS THE ANSWER. This used to `console.warn` and fall
      // through to the branch below, which can only ever throw "Creating an
      // agreement requires a workspace. See lib/agreements." — so whatever
      // actually went wrong was replaced by a sentence naming a source file,
      // and the cause was only in the console.
      //
      // That is how a stale stored workspace — a namespace the node no longer
      // has, which is ordinary after a node reset — came out as a message
      // about lib/agreements rather than "that workspace no longer exists".
      //
      // The fallback cannot succeed (see below), so there is nothing to fall
      // back TO. Report what happened.
      return {
        data: undefined,
        error: {
          code: 500,
          message:
            error instanceof Error
              ? error.message
              : 'Could not create the agreement.',
        },
      };
    }

    try {
      // ⚠️ WAS `import.meta.env.VITE_APPLICATION_ID`, with a base58 id in
      // `.env.example` to copy. An ApplicationId is `hash(package, signer)` and
      // therefore per-install, so a baked one is right only on the machine it
      // came from; core answers a request naming an unknown application with an
      // opaque 500 that never mentions application ids. Ask the node which
      // installed app is us, matched by package. See `lib/appId.ts`.
      const applicationId = await resolveApplicationId(() =>
        apiClient.node().getInstalledApplications(),
      );
      if (!applicationId) {
        throw new Error(
          `${APP_PACKAGE} is not installed on this node, so there is no ` +
            'application to create a context for. Install it from the registry ' +
            'and try again.',
        );
      }
      // ⚠️ THE LEGACY FALLBACK IS GONE, and it could not have worked.
      // It posted `protocol: 'near'` — a field core removed — and no
      // `group_id`, which `CreateContextRequest` requires. Against
      // `deny_unknown_fields` that is a 400 for the whole call.
      //
      // So this line is only reachable with NO node connection at all — the
      // `if (this.app)` above returns or reports in every other case. It says
      // that, rather than naming a source file at somebody trying to click a
      // button.
      throw new Error(
        'No node connection yet, so there is nothing to create an agreement ' +
          'on. Reconnect and try again.',
      );
    } catch (error) {
      let errorMessage = 'An unexpected error occurred during createContext';
      if (error instanceof Error) {
        errorMessage = error.message;
      }
      return {
        data: undefined,
        error: {
          code: 500,
          message: errorMessage,
        },
      };
    }
  }

  async inviteToContext(
    props: InviteToContextProps,
  ): Promise<{ data?: string; error?: any }> {
    try {
      if (this.app) {
        const result = await this.app.inviteToContext({
          contextId: props.contextId,
          inviterId: props.inviter,
          inviteeId: props.invitee,
        });
        return { data: result, error: null };
      }
    } catch (error) {
      console.warn('App inviteToContext failed, falling back to API:', error);
    }

    try {
      // Invitations are minted against the WORKSPACE now, not a context —
      // see `lib/agreements`. The old per-context route no longer exists.
      throw new Error(
        'Invite people to the workspace; the agreement is reached from there.',
      );
    } catch (error) {
      console.error('inviteToContext failed:', error);
      let errorMessage = 'An unexpected error occurred during inviteToContext';
      if (error instanceof Error) {
        errorMessage = error.message;
      }
      return {
        data: undefined,
        error: {
          code: 500,
          message: errorMessage,
        },
      };
    }
  }

  async joinContext(
    props: JoinContextProps,
  ): Promise<{ data?: JoinContextResponse; error?: any }> {
    try {
      if (this.app) {
        const result = await this.app.joinContext({
          invitationPayload: props.invitationPayload,
        });
        return { data: result, error: null };
      }
    } catch (error) {
      // ⚠️ REPORT IT. This used to `console.warn` and fall through to the
      // branch below, whose only outcome is "No node connection yet, so this
      // invitation cannot be redeemed" — so a node that was connected fine
      // got blamed for a 403, or for
      //
      //     Invalid context id format: expected 64 hex characters (32 bytes)
      //
      // which is what `joinContext` answered when it was handed an invitation
      // payload instead of a context id. The same swallow-and-replace as
      // `createContext` above, found the same way: by the message being wrong.
      return {
        data: undefined,
        error: {
          code: 500,
          message:
            error instanceof Error
              ? error.message
              : 'Could not redeem that invitation.',
        },
      };
    }

    try {
      // ⚠️ THIS FALLBACK CANNOT ANSWER WITH A CONTEXT, and must not pretend to.
      //
      // It used to post the payload to `joinContextByOpenInvitation` and cast
      // the reply to `{contextId, memberPublicKey}`. Since the workspace model
      // that call joins a NAMESPACE and answers `{namespaceId, memberIdentity,
      // memberAccount}` — no context, because membership of a workspace is not
      // membership of the agreements inside it. The cast compiled and produced
      // `contextId: undefined`, which the caller reported as "the node accepted
      // the invitation but did not say which context it joined".
      //
      // An OPEN invitation belongs to `redeemInvitation`, which knows how to
      // enter a subgroup afterwards. What is left here is the TARGETED path,
      // and it only reaches this line when `this.app` is absent — i.e. before
      // the node connection exists.
      throw new Error(
        'No node connection yet, so this invitation cannot be redeemed. ' +
          'Reconnect and try again.',
      );
    } catch (error) {
      console.error('joinContext failed:', error);
      let errorMessage = 'An unexpected error occurred during joinContext';
      if (error instanceof Error) {
        errorMessage = error.message;
      }
      return {
        data: undefined,
        error: {
          code: 500,
          message: errorMessage,
        },
      };
    }
  }

  async verifyContext(
    props: VerifyContextProps,
  ): Promise<{ data?: VerifyContextResponse; error?: any }> {
    try {
      if (this.app) {
        const result = await this.app.verifyContext({
          contextId: props.contextId,
        });
        return { data: { joined: result.joined || false }, error: null };
      }
    } catch (error) {
      console.warn('App verifyContext failed, falling back to API:', error);
    }

    try {
      const result = await apiClient.node().getContext(props.contextId);
      return { data: { joined: !!result.data }, error: null };
    } catch (error) {
      console.error('Error fetching context:', error);
      return {
        data: undefined,
        error: { code: 500, message: 'Failed to fetch context data.' },
      };
    }
  }
}
