import { IEvent, Member } from "../../types/event";

export interface IEventsState {
  events: IEvent[];
  // FEATURE (missing names): members resolved from get_members() so the UI can
  // render usernames instead of raw 44-char public keys.
  members: Member[];
}
