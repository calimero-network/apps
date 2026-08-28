import React, { FC, MouseEvent } from 'react';

import styles from './event.module.scss';
import { usePopup } from '../../../../../../hooks/usePopup';

interface IEventProps {
  height: number;
  top: number;
  title: string;
  time: string;
  color: string;
  id: string;
  width: string;
  left: string;
  isPrivate?: boolean;
}

const Event: FC<IEventProps> = ({
  height,
  top,
  title,
  time,
  color,
  id,
  width,
  left,
  isPrivate
}) => {
  const { openPopup } = usePopup();

  const eventStyle = {
    height: height > 0 ? height : 'auto',
    top,
    background: color,
    width,
    left,
    // FEATURE: private events get a dashed outline marker
    border: isPrivate ? '1.5px dashed rgba(255,255,255,0.85)' : undefined
  };

  const handleClick = (e: MouseEvent<HTMLElement>) => {
    e.stopPropagation();
    const { clientX, clientY } = e;
    openPopup({ x: clientX, y: clientY, eventId: id });
  }

  return (
    <div
      style={eventStyle}
      className={styles.event}
      onClick={handleClick}
      data-testid="event-chip"
      data-private={isPrivate ? "true" : "false"}
    >
      <div className={styles.event__title}>
        {isPrivate && <span title="Private event">🔒 </span>}
        {title}
      </div>
      <div className={styles.event__time}>{time}</div>
    </div>
  );
};

export default Event;
