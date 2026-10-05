import { getContextId } from "@calimero-network/mero-react";
import { callContract } from "../contract";
import { accountId } from "../identity";
import {
  addPrivateEvent,
  isLocalEventId,
  listPrivateEvents,
  privateStoreKey,
  removePrivateEvent,
  updatePrivateEvent,
} from "../privateStore";
import { getSession, type DataSession } from "../session";
import {
  ApiResponse,
  ClientApi,
  ClientMethod,
  CreateEventResponse,
  DeleteEventResponse,
  GetEventsResponse,
  GetMembersResponse,
  IEventJsonRpc,
  UpdateEventResponse,
} from "../clientApi";
import { IEvent, IEventCreate, Member, TPartialEvent } from "../../types/event";
import parseEvents from "../../utils/helpers/parseEvents";

// ── Data source ───────────────────────────────────────────────────────────────
//
// The *active context* is whatever the CalendarPage set via setContextId() on
// mount, read back from getContextId(). The transport is the session's
// `mero.rpc` (see api/session): a node's JSON-RPC, or the relay for an account
// — the data source itself has no idea which, and does not need to, except for
// one thing: PRIVATE EVENTS.
//
// On a node, a private event is the contract's `#[app::private]` storage —
// node-local, never replicated. The contract also routes a PEERLESS shared
// event there on its own (`create_event` with no peers → private), because an
// event nobody else is party to has no business in the replicated log.
//
// An account has no node. Its contract calls run on a relay, and a relay has
// NO private storage for the accounts it serves (core answers a delegated run
// with a typed error; before that every account shared one bucket). So on a
// delegated session nothing private — and nothing peerless, which the contract
// would make private — is sent to the contract at all: it is kept in the
// device-local store (api/privateStore), keyed by account + team. The node
// path is untouched.

/** The context the CalendarPage activated. Throws a friendly error if missing. */
function activeContextId(): string {
  const id = getContextId();
  if (!id) throw new Error("No active calendar context");
  return id;
}

function fail(error: unknown, where: string) {
  console.error(`${where} failed:`, error);
  let message = `An unexpected error occurred during ${where}`;
  if (error instanceof Error) message = error.message;
  else if (typeof error === "string") message = error;
  return { data: null, error: { code: 500, message } };
}

export class ClientApiDataSource implements ClientApi {
  /**
   * `session` is read per call, not captured: the redux thunks build one
   * instance at module load, before anyone has signed in.
   */
  constructor(private readonly session: () => DataSession = getSession) {}

  private rpc() {
    const { rpc } = this.session();
    if (!rpc) throw new Error("Not connected");
    return rpc;
  }

  /** True when private events live on this device rather than in the contract. */
  private deviceLocalPrivate(): boolean {
    return this.session().isDelegated;
  }

  private localKey(): string {
    return privateStoreKey(accountId(), this.session().namespaceId);
  }

  async getEvents(): ApiResponse<GetEventsResponse> {
    try {
      const contextId = activeContextId();
      const shared = await callContract<IEventJsonRpc[]>(
        this.rpc(),
        contextId,
        ClientMethod.GET_EVENTS,
        {},
      );
      // FEATURE (private events): fetch BOTH the shared and private event sets
      // and merge them. The contract stamps `private` on each, but we set it
      // defensively here too so the calendar can route edits correctly.
      const priv: IEvent[] = this.deviceLocalPrivate()
        ? listPrivateEvents(this.localKey(), contextId)
        : parseEvents(
            (
              await callContract<IEventJsonRpc[]>(
                this.rpc(),
                contextId,
                ClientMethod.GET_PRIVATE_EVENTS,
                {},
              ).catch(() => [] as IEventJsonRpc[])
            ).map((e) => ({ ...e, private: true })),
          );
      const events: IEvent[] = [
        ...parseEvents((shared ?? []).map((e) => ({ ...e, private: false }))),
        ...priv,
      ];
      return { data: events, error: null };
    } catch (error) {
      return fail(error, "getEvents");
    }
  }

  async getMembers(): ApiResponse<GetMembersResponse> {
    try {
      const contextId = activeContextId();
      // Member field names are camelCase straight from the contract.
      const members = await callContract<Member[]>(
        this.rpc(),
        contextId,
        ClientMethod.GET_MEMBERS,
        {},
      );
      return { data: Array.isArray(members) ? members : [], error: null };
    } catch (error) {
      return fail(error, "getMembers");
    }
  }

  async createEvent(event: IEventCreate): ApiResponse<CreateEventResponse> {
    try {
      const contextId = activeContextId();
      // On an account, a private event — and a peerless one, which the contract
      // would route to its private storage — stays on this device.
      if (
        this.deviceLocalPrivate() &&
        (event.private || (event.peers ?? []).length === 0)
      ) {
        const id = addPrivateEvent(this.localKey(), contextId, accountId(), event);
        return { data: id, error: null };
      }
      // Route to the private contract method when the event is private. Private
      // events ignore `peers`, but we send the array regardless — harmless.
      const method = event.private
        ? ClientMethod.CREATE_PRIVATE_EVENT
        : ClientMethod.CREATE_EVENT;
      const eventId = await callContract<string>(this.rpc(), contextId, method, {
        event_data: {
          title: event.title,
          description: event.description,
          start: event.start,
          end: event.end,
          event_type: event.type,
          color: event.color,
          peers: event.peers, // the real string[] of pubkeys
        },
        timestamp: Date.now(),
      });
      if (!eventId) return { error: { code: 500, message: "Event ID is missing" } };
      return { data: eventId, error: null };
    } catch (error) {
      return fail(error, "createEvent");
    }
  }

  async updateEvent(
    eventId: string,
    eventData: TPartialEvent,
  ): ApiResponse<UpdateEventResponse> {
    try {
      const contextId = activeContextId();
      if (this.deviceLocalPrivate() && (eventData.private || isLocalEventId(eventId))) {
        if (!updatePrivateEvent(this.localKey(), eventId, eventData)) {
          return { error: { code: 404, message: "Private event not found on this device" } };
        }
        return { data: eventId, error: null };
      }
      const method = eventData.private
        ? ClientMethod.UPDATE_PRIVATE_EVENT
        : ClientMethod.UPDATE_EVENT;
      const eventIdResponse = await callContract<string>(
        this.rpc(),
        contextId,
        method,
        {
          event_id: eventId,
          event_data: {
            title: eventData.title ?? null,
            description: eventData.description ?? null,
            start: eventData.start ?? null,
            end: eventData.end ?? null,
            event_type: eventData.type ?? null,
            color: eventData.color ?? null,
            // the real string[] (or null to leave unchanged).
            peers: eventData.peers ?? null,
          },
          timestamp: Date.now(),
        },
      );
      if (!eventIdResponse)
        return { error: { code: 500, message: "Event ID is missing" } };
      return { data: eventIdResponse, error: null };
    } catch (error) {
      return fail(error, "updateEvent");
    }
  }

  async deleteEvent(
    eventId: string,
    isPrivate: boolean,
  ): ApiResponse<DeleteEventResponse> {
    try {
      const contextId = activeContextId();
      if (this.deviceLocalPrivate() && (isPrivate || isLocalEventId(eventId))) {
        if (!removePrivateEvent(this.localKey(), eventId)) {
          return { error: { code: 404, message: "Private event not found on this device" } };
        }
        return { data: eventId, error: null };
      }
      const method = isPrivate
        ? ClientMethod.DELETE_PRIVATE_EVENT
        : ClientMethod.DELETE_EVENT;
      const eventIdResponse = await callContract<string>(
        this.rpc(),
        contextId,
        method,
        { event_id: eventId },
      );
      if (!eventIdResponse)
        return { error: { code: 500, message: "Event ID is missing" } };
      return { data: eventIdResponse, error: null };
    } catch (error) {
      return fail(error, "deleteEvent");
    }
  }

  async setUsername(username: string): ApiResponse<null> {
    try {
      const contextId = activeContextId();
      await callContract<null>(this.rpc(), contextId, ClientMethod.SET_USERNAME, {
        username,
        timestamp: Date.now(),
      });
      return { data: null, error: null };
    } catch (error) {
      return fail(error, "setUsername");
    }
  }
}
