import { IEvent, IEventCreate, Member, TPartialEvent } from "../types/event";

// ── rc.8 client API surface ──────────────────────────────────────────────────
// Previously this imported `ApiResponse` from @calimero-network/calimero-client.
// That SDK is gone; we define the same envelope shape locally so the redux
// thunks keep their { data, error } contract unchanged.

export interface ApiError {
  code: number;
  message: string;
}

export type ApiResponse<T> = Promise<{ data?: T | null; error?: ApiError | null }>;

/** Raw event shape returned by the contract (snake_case event_type, peer pubkeys). */
export interface IEventJsonRpc {
  id: string;
  title: string;
  description: string;
  start: string;
  peers: string[];
  end: string;
  event_type: string;
  color: string;
  owner: string;
  private?: boolean;
}

// create/update/delete all return a bare event-id string from the contract.
export type CreateEventResponse = string;
export type DeleteEventResponse = string;
export type UpdateEventResponse = string;
export type GetEventsResponse = IEvent[];
export type GetMembersResponse = Member[];

export enum ClientMethod {
  GET_EVENTS = "get_events",
  GET_PRIVATE_EVENTS = "get_private_events",
  CREATE_EVENT = "create_event",
  CREATE_PRIVATE_EVENT = "create_private_event",
  DELETE_EVENT = "delete_event",
  DELETE_PRIVATE_EVENT = "delete_private_event",
  UPDATE_EVENT = "update_event",
  UPDATE_PRIVATE_EVENT = "update_private_event",
  SET_USERNAME = "set_username",
  GET_MEMBERS = "get_members",
}

export interface ClientApi {
  getEvents(): ApiResponse<GetEventsResponse>;
  getMembers(): ApiResponse<GetMembersResponse>;
  createEvent(event: IEventCreate): ApiResponse<CreateEventResponse>;
  deleteEvent(eventId: string, isPrivate: boolean): ApiResponse<DeleteEventResponse>;
  updateEvent(
    eventId: string,
    eventData: TPartialEvent,
  ): ApiResponse<UpdateEventResponse>;
  setUsername(username: string): ApiResponse<null>;
}
