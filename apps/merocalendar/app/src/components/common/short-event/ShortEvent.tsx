import React, { FC, MouseEvent } from "react";


import styles from './short-event.module.scss';
import { usePopup } from "../../../hooks/usePopup";
import { formatDate } from "../../../utils/date";
import { IEvent } from "../../../types/event";

interface IShortEventProps {
  event: IEvent;
  top: number;
}

const ShortEvent: FC<IShortEventProps> = ({
  event,
  top
}) => {
  const { openPopup } = usePopup();

  const handleOpenModal = (e: MouseEvent<HTMLDivElement>) => {
    const { clientX, clientY } = e;
    e.stopPropagation();
    openPopup({
      x: clientX,
      y: clientY,
      eventId: event.id
    });
  }
  
  const timeStart = formatDate(new Date(event.start), 'hh:mm');

  const eventStyle = { top: `${top}px` };
  
  const eventCircleStyle = { background: event.color };

  return (
    <div
      className={styles.event}
      onClick={handleOpenModal}
      style={eventStyle}
      data-testid="event-chip"
      data-private={event.private ? "true" : "false"}
    >
      <div
        className={styles.event__circle}
        style={eventCircleStyle}
      />
      {/* FEATURE: private events get a lock marker */}
      {event.private && <span className={styles.event__lock} title="Private event">🔒</span>}
      <div className={styles.event__time}>{timeStart}</div>
      <div className={styles.event__title}>{event.title}</div>
    </div>
  );
}

export default ShortEvent;