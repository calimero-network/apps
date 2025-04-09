import { ApiResponse } from '@calimero-network/calimero-client';
import { IEventCreate, TPartialEvent } from '../types/event';

export interface GetEventsResponse {}

export interface CreateEventResponse {}

export interface DeleteEventResponse {}

export interface UpdateEventResponse {}

export enum ClientMethod {
  GET_EVENTS = "get_events",
  CREATE_EVENT = "create_event",
  DELETE_EVENT = "delete_event",
  UPDATE_EVENT = "update_event",
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

export interface ClientApi {
  getEvents(): ApiResponse<GetEventsResponse>;
  createEvent(event: IEventCreate): ApiResponse<CreateEventResponse>;
  deleteEvent(eventId: string): ApiResponse<DeleteEventResponse>;
  updateEvent(
    eventId: string,
    eventData: TPartialEvent
  ): ApiResponse<UpdateEventResponse>;
}
