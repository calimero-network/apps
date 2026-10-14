import React, { FC, useEffect, useRef } from 'react';
import Navigation from './components/navigation/Navigation';
import Week from './components/week/Week';
import Sidebar from './components/sidebar/Sidebar';
import LongEvents from './components/long-events/LongEvents';

import styles from './week-calendar.module.scss';
import { useTypedSelector } from '../../../../hooks/useTypedSelector';
import { IMonthDay, IWeekDay } from '../../../../types/date';
import { getEventsInterval, getLongEvents, getShortEvents } from '../../../../utils/helpers';

// One hour is 60px tall (hour.module.scss); events are placed on that scale.
const HOUR_HEIGHT = 60;
const FIRST_VISIBLE_HOUR = 7;

interface IWeekCalendarProps {
  weekDays: IMonthDay[];
  weekDaysNames: IWeekDay[];
}

const WeekCalendar: FC<IWeekCalendarProps> = ({ weekDays, weekDaysNames }) => {
  const { events } = useTypedSelector(({ events }) => events);
  
  const weekEvents = getEventsInterval(weekDays, events);
  const shortEvents = getShortEvents(weekEvents);
  const longEvents = getLongEvents(weekEvents);

  // Open on the working day, not on midnight: the hours above 7:00 are one
  // scroll away rather than the first screenful.
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Less a few pixels, so the hour's own label is not cut by the edge.
    if (bodyRef.current) bodyRef.current.scrollTop = FIRST_VISIBLE_HOUR * HOUR_HEIGHT - 12;
  }, []);

  return (
    <>
      <div className={styles.calendar__week__header__container}>
        <Navigation
          weekDays={weekDays}
          weekDaysNames={weekDaysNames}
        />
        <LongEvents
          weekDays={weekDays}
          events={longEvents}
        />
      </div>
      <div className="calendar__body" ref={bodyRef}>
        <div className={styles.calendar__week__container}>
          <Sidebar />
          <Week
            events={shortEvents}
            weekDays={weekDays}
          />
        </div>
      </div>
    </>
  );
}

export default WeekCalendar;
