import React, { useEffect } from 'react';
import {
  getContextId,
  getExecutorPublicKey,
  NodeEvent,
  SubscriptionsClient,
} from '@calimero-network/calimero-client';

import { getWsSubscriptionsClient } from '../../api/dataSource/ClientApiDataSource';
import Calendar from '../../components/calendar/Calendar';

import '../../common.scss';
import { useActions, useModal } from '../../hooks';
import { useNavigate } from 'react-router-dom';

export default function CalendarPage() {
  const navigate = useNavigate();
  const pk = getExecutorPublicKey();
  const contextId = getContextId();
  const { getEvents } = useActions();
  const { openErrorModal, closeErrorModal } = useModal();

  useEffect(() => {
    if (!pk || !contextId) {
      navigate('/login');
    }
  }, [pk, contextId, navigate]);

  const observeNodeEvents = async () => {
    closeErrorModal();
    try {
      let subscriptionsClient: SubscriptionsClient = getWsSubscriptionsClient();
      await subscriptionsClient.connect();
      subscriptionsClient.subscribe([getContextId() ?? '']);

      subscriptionsClient?.addCallback(async(data: NodeEvent) => {
        try {
          //@ts-ignore
          if (data.data.newRoot && data.type === 'StateMutation') {
            try {
              // @ts-ignore
              await getEvents().unwrap();
            } catch (error: any) {
              openErrorModal({
                message: error.message,
                errorType: 'appError',
              });
            }
          }
          if (
            'events' in data.data &&
            Array.isArray(data.data.events) &&
            data.data.events.length > 0
          ) {
            const event = data.data.events[0];
            if (event.data && Array.isArray(event.data)) {
              try {
                // @ts-ignore
                await getEvents().unwrap();
              } catch (error: any) {
                openErrorModal({
                  message: error.message,
                  errorType: 'appError',
                });
              }
            }
          }
        } catch (callbackError) {
          console.error('Error in subscription callback:', callbackError);
        }
      });
    } catch (error) {
      console.error('Error in node websocket:', error);
      openErrorModal({
        message: 'Websocket connection error, check if node is running.',
        errorType: 'websocket',
      });
    }
  };

  useEffect(() => {
    observeNodeEvents();
    const fetchEvents = async () => {
      try {
        // @ts-ignore
        await getEvents().unwrap();
      } catch (error: any) {
        // openErrorModal({
        //   message: error.message,
        //   errorType: 'appError',
        // });
      }
    };

    fetchEvents();
  }, []);


  return (
    <div>
      <Calendar />
    </div>
  );
}
