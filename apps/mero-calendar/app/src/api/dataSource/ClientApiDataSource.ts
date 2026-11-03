import { calendar, messageOf, type Calendar, type EventFields } from "../calendar";
import { getBinding, type Binding } from "../binding";
import {
  ApiResponse,
  ClientApi,
  CreateEventResponse,
  DeleteEventResponse,
  GetEventsResponse,
  GetMembersResponse,
  UpdateEventResponse,
} from "../clientApi";
import { IEventCreate, TPartialEvent } from "../../types/event";
import parseEvents from "../../utils/helpers/parseEvents";

// ── Data source ───────────────────────────────────────────────────────────────
//
// The open calendar (an app instance) and the signed-in client are what the
// calendar page bound (`api/binding`). Shared and private events both live in
// the contract now, for every session: v1 kept an account's private events in
// this browser (a relay had no node-local storage); on Calimero 1.0 they are
// the account's own rows in the app, which only its own calls read.

function fail(error: unknown, where: string) {
  console.error(`${where} failed:`, error);
  const message = messageOf(error) || `An unexpected error occurred during ${where}`;
  const status = (error as { status?: unknown } | null)?.status;
  return { data: null, error: { code: typeof status === "number" ? status : 500, message } };
}

function fields(event: IEventCreate): EventFields {
  return {
    title: event.title,
    description: event.description,
    start: event.start,
    end: event.end,
    event_type: event.type,
    color: event.color,
    peers: event.peers ?? [],
  };
}

export class ClientApiDataSource implements ClientApi {
  /**
   * `binding` is read per call, not captured: the redux thunks build one
   * instance at module load, before anyone has signed in.
   */
  constructor(private readonly binding: () => Binding = getBinding) {}

  private cal(): Calendar {
    const { client, app, after } = this.binding();
    if (!client) throw new Error("Not connected");
    if (!app) throw new Error("No active calendar");
    return calendar(client, app, after);
  }

  async getEvents(): ApiResponse<GetEventsResponse> {
    try {
      const cal = this.cal();
      const [shared, priv] = await Promise.all([cal.getEvents(), cal.getPrivateEvents()]);
      return {
        data: [
          ...parseEvents(shared.map((e) => ({ ...e, private: false }))),
          ...parseEvents(priv.map((e) => ({ ...e, private: true }))),
        ],
        error: null,
      };
    } catch (error) {
      return fail(error, "getEvents");
    }
  }

  async getMembers(): ApiResponse<GetMembersResponse> {
    try {
      return { data: await this.cal().getMembers(), error: null };
    } catch (error) {
      return fail(error, "getMembers");
    }
  }

  async createEvent(event: IEventCreate): ApiResponse<CreateEventResponse> {
    try {
      const cal = this.cal();
      // The contract routes a peerless event to private on its own; a private
      // one keeps its peers out.
      const id = event.private
        ? await cal.createPrivateEvent(fields(event))
        : await cal.createEvent(fields(event));
      if (!id) return { error: { code: 500, message: "Event ID is missing" } };
      return { data: id, error: null };
    } catch (error) {
      return fail(error, "createEvent");
    }
  }

  async updateEvent(eventId: string, eventData: TPartialEvent): ApiResponse<UpdateEventResponse> {
    try {
      const cal = this.cal();
      const update = {
        title: eventData.title,
        description: eventData.description,
        start: eventData.start,
        end: eventData.end,
        event_type: eventData.type,
        color: eventData.color,
        peers: eventData.peers,
      };
      const id = eventData.private
        ? await cal.updatePrivateEvent(eventId, update)
        : await cal.updateEvent(eventId, update);
      if (!id) return { error: { code: 500, message: "Event ID is missing" } };
      return { data: id, error: null };
    } catch (error) {
      return fail(error, "updateEvent");
    }
  }

  async deleteEvent(eventId: string, isPrivate: boolean): ApiResponse<DeleteEventResponse> {
    try {
      const cal = this.cal();
      const id = isPrivate ? await cal.deletePrivateEvent(eventId) : await cal.deleteEvent(eventId);
      if (!id) return { error: { code: 500, message: "Event ID is missing" } };
      return { data: id, error: null };
    } catch (error) {
      return fail(error, "deleteEvent");
    }
  }

  async setUsername(username: string): ApiResponse<null> {
    try {
      await this.cal().setUsername(username);
      return { data: null, error: null };
    } catch (error) {
      return fail(error, "setUsername");
    }
  }
}
