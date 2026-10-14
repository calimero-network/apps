import React, { CSSProperties, FC, MouseEvent } from 'react';
import cn from 'classnames';

import styles from './event.module.scss';
import { usePopup } from '../../../../../../hooks/usePopup';
import { LockIcon } from "../../../../../common/icons/Icons";

const COMPACT_BELOW = 44;

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

  // `--ev` carries the owner's colour into the stylesheet, which tints the
  // chip with it rather than filling it (see event.module.scss).
  const eventStyle = {
    height: height > 0 ? height : 'auto',
    top,
    width,
    left,
    '--ev': color,
  } as CSSProperties;

  const handleClick = (e: MouseEvent<HTMLElement>) => {
    e.stopPropagation();
    const { clientX, clientY } = e;
    openPopup({ x: clientX, y: clientY, eventId: id });
  }

  return (
    <div
      style={eventStyle}
      // FEATURE: private events get a dashed outline marker
      className={cn(styles.event, {
        [styles.event_private]: isPrivate,
        // Too short for two lines (under ~45 minutes): title and time share one.
        [styles.event_compact]: height > 0 && height < COMPACT_BELOW,
      })}
      onClick={handleClick}
      data-testid="event-chip"
      data-private={isPrivate ? "true" : "false"}
    >
      <div className={styles.event__title}>
        {isPrivate && <LockIcon title="Private event" size={11} />}
        {title}
      </div>
      <div className={styles.event__time}>{time}</div>
    </div>
  );
};

export default Event;
