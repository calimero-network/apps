import { IEventJsonRpc } from '../../api/clientApi';
import { IEvent, TEventTypes } from '../../types/event';

export default function parseEvents(events: IEventJsonRpc[]): IEvent[] {
    return events.map((event) => ({
      id: event.id,
      title: event.title,
      description: event.description,
      peers: event.peers.join(',') ?? '',
      start: event.start,
      end: event.end,
      type: event.event_type as TEventTypes,
      color: event.color,
      owner: event.owner,
    }));
}
