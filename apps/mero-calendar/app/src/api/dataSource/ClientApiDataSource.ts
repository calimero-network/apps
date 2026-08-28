import { getContextId } from "@calimero-network/mero-react";
import { rpcCall } from "../rpc";
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

// ── rc.8 data source ──────────────────────────────────────────────────────────
//
// The legacy version pulled contextId + executorPublicKey out of getAuthConfig()
// and went through JsonRpcClient. In rc.8 the *active context* is whatever the
// CalendarPage set via setContextId() on mount, so we read it back from
// getContextId(). The JWT (set by mero-react) carries the caller identity, so we
// no longer pass an executorPublicKey — rpcCall() handles auth headers.

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
  async getEvents(): ApiResponse<GetEventsResponse> {
    try {
      const contextId = activeContextId();
      // FEATURE (private events): fetch BOTH the shared and node-local event
      // sets and merge them. The contract stamps `private` on each, but we set
      // it defensively here too so the calendar can route edits correctly.
      const [shared, priv] = await Promise.all([
        rpcCall<IEventJsonRpc[]>(contextId, ClientMethod.GET_EVENTS, {}),
        rpcCall<IEventJsonRpc[]>(contextId, ClientMethod.GET_PRIVATE_EVENTS, {}).catch(
          () => [] as IEventJsonRpc[],
        ),
      ]);
      const events: IEvent[] = [
        ...parseEvents((shared ?? []).map((e) => ({ ...e, private: false }))),
        ...parseEvents((priv ?? []).map((e) => ({ ...e, private: true }))),
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
      const members = await rpcCall<Member[]>(contextId, ClientMethod.GET_MEMBERS, {});
      return { data: Array.isArray(members) ? members : [], error: null };
    } catch (error) {
      return fail(error, "getMembers");
    }
  }

  async createEvent(event: IEventCreate): ApiResponse<CreateEventResponse> {
    try {
      const contextId = activeContextId();
      // Route to the private contract method when the event is private. Private
      // events ignore `peers`, but we send the array regardless — harmless.
      const method = event.private
        ? ClientMethod.CREATE_PRIVATE_EVENT
        : ClientMethod.CREATE_EVENT;
      const eventId = await rpcCall<string>(contextId, method, {
        event_data: {
          title: event.title,
          description: event.description,
          start: event.start,
          end: event.end,
          event_type: event.type,
          color: event.color,
          peers: event.peers, // BUGFIX: send the real string[] of pubkeys
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
      const method = eventData.private
        ? ClientMethod.UPDATE_PRIVATE_EVENT
        : ClientMethod.UPDATE_EVENT;
      const eventIdResponse = await rpcCall<string>(contextId, method, {
        event_id: eventId,
        event_data: {
          title: eventData.title ?? null,
          description: eventData.description ?? null,
          start: eventData.start ?? null,
          end: eventData.end ?? null,
          event_type: eventData.type ?? null,
          color: eventData.color ?? null,
          // BUGFIX: pass the real string[] (or null to leave unchanged).
          peers: eventData.peers ?? null,
        },
        timestamp: Date.now(),
      });
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
      const method = isPrivate
        ? ClientMethod.DELETE_PRIVATE_EVENT
        : ClientMethod.DELETE_EVENT;
      const eventIdResponse = await rpcCall<string>(contextId, method, {
        event_id: eventId,
      });
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
      await rpcCall<null>(contextId, ClientMethod.SET_USERNAME, {
        username,
        timestamp: Date.now(),
      });
      return { data: null, error: null };
    } catch (error) {
      return fail(error, "setUsername");
    }
  }
}
