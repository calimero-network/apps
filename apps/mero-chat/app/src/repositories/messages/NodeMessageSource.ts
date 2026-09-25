import type {
  Channel,
  ClientApi,
  MessageWithReactions,
  UserId,
} from "../../api/clientApi";
import type { MessagePage, MessageSource } from "./MessageSync";

/**
 * Where a channel is on the node, as `MessageSyncEngine` needs to address it.
 *
 * The engine keys everything by `contextId` because that is what identifies a
 * channel's storage. Executing a call needs more than that — the channel object
 * and, for a DM, the identity to execute as — so the binding is supplied here
 * rather than smuggled into the engine, which has no business knowing about
 * DMs.
 */
export interface ChannelBinding {
  contextId: string;
  group: Channel;
  isDm?: boolean;
  dmIdentity?: UserId;
}

/**
 * `MessageSource` over the node's JSON-RPC surface.
 *
 * Both calls address history from the START of the channel, which is the whole
 * reason they exist alongside `getMessages`: a position counted from the end
 * changes meaning as soon as anything is appended, so it cannot be persisted
 * and resumed. See `MessageSync.ts`.
 */
export class NodeMessageSource implements MessageSource<MessageWithReactions> {
  constructor(
    private readonly api: ClientApi,
    /** Resolves a context id to what a call needs, or undefined if unknown. */
    private readonly bindings: (contextId: string) => ChannelBinding | undefined,
  ) {}

  async range(
    contextId: string,
    start: number,
    limit: number,
  ): Promise<MessagePage<MessageWithReactions>> {
    const binding = this.bindings(contextId);
    if (!binding) return { messages: [], totalCount: 0 };

    const { data, error } = await this.api.getMessagesFrom({
      group: binding.group,
      start,
      limit,
      is_dm: binding.isDm,
      dm_identity: binding.dmIdentity,
      refetch_context_id: contextId,
      refetch_identity: binding.dmIdentity,
    });

    // Throw rather than return an empty page. An empty page is how the engine
    // learns "the channel ends here", and it advances its cursor accordingly —
    // so returning one for a network failure would write a gap into the cursor
    // that no later read could detect. Failing loudly leaves the cursor where
    // it was, and the next catch-up simply tries again.
    if (error || !data) throw new Error(error?.message ?? "getMessagesFrom failed");

    return { messages: data.messages, totalCount: data.total_count };
  }

  async count(contextId: string): Promise<number> {
    const binding = this.bindings(contextId);
    if (!binding) return 0;

    const { data, error } = await this.api.getMessageCount({
      group: binding.group,
      is_dm: binding.isDm,
      dm_identity: binding.dmIdentity,
      refetch_context_id: contextId,
      refetch_identity: binding.dmIdentity,
    });

    if (error || data === null || data === undefined) {
      throw new Error(error?.message ?? "getMessageCount failed");
    }
    return data;
  }
}
