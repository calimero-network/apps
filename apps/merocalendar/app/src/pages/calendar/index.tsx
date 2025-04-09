import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  getAccessToken,
  getAppEndpointKey,
  getApplicationId,
  getContextId,
  getRefreshToken,
  NodeEvent,
  SubscriptionsClient,
} from '@calimero-network/calimero-client';

import {
  getWsSubscriptionsClient,
} from '../../api/dataSource/ClientApiDataSource';
import Calendar from '../../components/calendar/Calendar';

import "../../common.scss";
import { useActions } from '../../hooks';

export default function CalendarPage() {
  const { getEvents } = useActions();

  useEffect(() => {
    getEvents();
  }, []);

  // useEffect(() => {
  //   if (!url || !applicationId || !accessToken || !refreshToken) {
  //     navigate('/login');
  //   }
  // }, [accessToken, applicationId, navigate, refreshToken, url]);

  // const observeNodeEvents = async () => {
  //   let subscriptionsClient: SubscriptionsClient = getWsSubscriptionsClient();
  //   await subscriptionsClient.connect();
  //   subscriptionsClient.subscribe([getContextId() ?? '']);

  //   subscriptionsClient?.addCallback((data: NodeEvent) => {
  //     if (
  //       'events' in data.data &&
  //       Array.isArray(data.data.events) &&
  //       data.data.events.length > 0
  //     ) {
  //       const event = data.data.events[0];
  //       if (event.data && Array.isArray(event.data)) {
  //       }
  //     }
  //   });
  // };

  // useEffect(() => {
  //   observeNodeEvents();
  // }, []);

  return <Calendar />;
}
