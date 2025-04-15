import { ApiResponse } from '@calimero-network/calimero-client';
import { IEventCreate, TPartialEvent } from '../types/event';

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
}

export interface GetEventsResponse {}

export interface CreateEventResponse {
  eventId: string;
}

export interface DeleteEventResponse {
  eventId: string;
}

export interface UpdateEventResponse {
  eventId: string;
}

export enum ClientMethod {
  GET_EVENTS = 'get_events',
  CREATE_EVENT = 'create_event',
  DELETE_EVENT = 'delete_event',
  UPDATE_EVENT = 'update_event',
}

export interface CalendarEvent {
  id: string;
  title: string;
  description: string;
  startDate: string;
  endDate: string;
  location: string;
  attendees: string[];
  status: string;
  type: string;
}

export interface Context {
  applicationId: string;
  id: string;
  rootHash: String;
}

export interface GetContextsResponse {
  contexts: Context[];
}

export interface FetchContextIdentitiesResponse {
  identities: string[];
}

export interface ClientApi {
  getEvents(): ApiResponse<GetEventsResponse>;
  createEvent(event: IEventCreate): ApiResponse<CreateEventResponse>;
  deleteEvent(eventId: string): ApiResponse<DeleteEventResponse>;
  updateEvent(
    eventId: string,
    eventData: TPartialEvent,
  ): ApiResponse<UpdateEventResponse>;
}
