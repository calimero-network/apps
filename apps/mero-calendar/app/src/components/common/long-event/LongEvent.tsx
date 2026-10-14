import cn from "classnames";
import React, { CSSProperties, FC, MouseEvent } from "react";

import styles from './long-event.module.scss';
import { IEvent } from "../../../types/event";
import { formatDate } from "../../../utils/date";
import { usePopup } from "../../../hooks/usePopup";
import { LockIcon } from "../icons/Icons";

interface ILongEventProps {
  event: IEvent;
  width: number;
  top: number;
  color: string;
  isShowEvent: boolean;
  isMovingToNext: boolean;
  isMovingFromPrev: boolean;
}

const LongEvent: FC<ILongEventProps> = ({
  event,
  width,
  top,
  color,
  isShowEvent,
  isMovingToNext,
  isMovingFromPrev
}) => {
  const { openPopup } = usePopup();
  // `--ev` carries the owner's colour into the stylesheet, which tints the
  // chip and its arrows with it (see long-event.module.scss).
  const eventStyle = {
    width: `calc(${width}% - 2%)`,
    top: `${top}px`,
    opacity: isShowEvent ? 1 : 0,
    zIndex: isShowEvent ? 1 : -1,
    '--ev': color,
  } as CSSProperties;

  const handleOpenModal = (e: MouseEvent<HTMLDivElement>) => {
    const { clientX, clientY } = e;
    e.stopPropagation();
    openPopup({
      x: clientX,
      y: clientY,
      eventId: event.id
    });
  }

  return (
    <div
      className={cn(styles.event, {
        [styles.event_left]: isMovingFromPrev,
        [styles.event_right]: isMovingToNext,
        [styles.event_private]: event.private,
      })}
      style={eventStyle}
      onClick={handleOpenModal}
      data-testid="event-chip"
      data-private={event.private ? "true" : "false"}
    >
      <div className={styles.event__container}>
        {event.private && <LockIcon title="Private event" size={11} />}
        {event.title}
        {event.type === 'event' && (
          `, ${formatDate(new Date(event.start), 'hh:mm')}`
        )}
        {isMovingFromPrev && (
          <div className={cn(styles.event__arrow, styles.event__arrow_left)}></div>
        )}
        {isMovingToNext && (
          <div className={cn(styles.event__arrow, styles.event__arrow_right)}></div>
        )}
      </div>
    </div>
  );
}

export default LongEvent;