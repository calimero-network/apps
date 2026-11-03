import { IEvent, IEventCreate, Member, TPartialEvent } from "../types/event";

// The data source's surface, as the redux thunks use it: a `{ data, error }`
// envelope per call. The contract behind it is `api/calendar.ts`.

export interface ApiError {
  code: number;
  message: string;
}

export type ApiResponse<T> = Promise<{ data?: T | null; error?: ApiError | null }>;

/** Raw event shape returned by the contract (snake_case event_type, peer account ids). */
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
