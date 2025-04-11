import { getExecutorPublicKey } from '@calimero-network/calimero-client';
import { IEventJsonRpc } from '../../api/clientApi';
import { IEvent, TEventTypes } from '../../types/event';

export default function parseEvents(events: IEventJsonRpc[]): IEvent[] {
  const owner = getExecutorPublicKey();

  if (owner === undefined || owner === null) {
    return events.map((event) => ({
      id: event.id,
      title: event.title,
      description: event.description,
      peers: event.peers ?? '',
      start: event.start,
      end: event.end,
      type: event.event_type as TEventTypes,
      color: event.color,
      owner: event.owner,
    }));
  }

  return events
    .filter((event) => {
      const peersList = event.peers
        ? event.peers.split(',').map((peer) => peer.trim())
        : [];
      return event.owner === owner || peersList.includes(owner as string);
    })
    .map((event) => ({
      id: event.id,
      title: event.title,
      description: event.description,
      peers: event.peers ?? '',
      start: event.start,
      end: event.end,
      type: event.event_type as TEventTypes,
      color: event.color,
      owner: event.owner,
    }));
}
