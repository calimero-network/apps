import React, { useEffect } from 'react';
import {
  getContextId,
  NodeEvent,
  SubscriptionsClient,
} from '@calimero-network/calimero-client';

import { getWsSubscriptionsClient } from '../../api/dataSource/ClientApiDataSource';
import Calendar from '../../components/calendar/Calendar';

import '../../common.scss';
import { useActions } from '../../hooks';

export default function CalendarPage() {
  const { getEvents } = useActions();

  const observeNodeEvents = async () => {
    let subscriptionsClient: SubscriptionsClient = getWsSubscriptionsClient();
    await subscriptionsClient.connect();
    subscriptionsClient.subscribe([getContextId() ?? '']);

    subscriptionsClient?.addCallback((data: NodeEvent) => {
      //@ts-ignore
      if (data.data.newRoot && data.type === 'StateMutation') {
        getEvents();
      }
      if (
        'events' in data.data &&
        Array.isArray(data.data.events) &&
        data.data.events.length > 0
      ) {
        const event = data.data.events[0];
        if (event.data && Array.isArray(event.data)) {
          getEvents();
        }
      }
    });
  };

  useEffect(() => {
    observeNodeEvents();
    getEvents();
  }, []);

  return (
    <div>
      <Calendar />
    </div>
  );
}
