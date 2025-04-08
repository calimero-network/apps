import { ApiResponse } from '@calimero-network/calimero-client';

export enum ClientMethod {
  GET_CALENDAR_EVENTS = 'get_calendar_events',
}

export interface GetCalendarEventsRequest {}

export interface GetCalendarEventsResponse {
  events: CalendarEvent[];
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
  getCalendarEvents(): ApiResponse<GetCalendarEventsResponse>;
}
