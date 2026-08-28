import { IEventJsonRpc } from "../../api/clientApi";
import { IEvent, TEventTypes } from "../../types/event";

// BUGFIX (peers collapse on edit): keep peers as a real `string[]` — no more
// joining with ',' then splitting on ', ' (mismatched delimiters merged every
// peer into one on edit). Also carry the `private` flag through.
export default function parseEvents(events: IEventJsonRpc[]): IEvent[] {
  return events.map((event) => ({
    id: event.id,
    title: event.title,
    description: event.description,
    peers: Array.isArray(event.peers) ? event.peers : [],
    start: event.start,
    end: event.end,
    type: event.event_type as TEventTypes,
    color: event.color,
    owner: event.owner,
    private: Boolean(event.private),
  }));
}
