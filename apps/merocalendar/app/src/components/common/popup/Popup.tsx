import React, { FC, useEffect, useRef, useState } from 'react';
import {
  useActions,
  useClickOutside,
  useModal,
  usePopup,
  useTypedSelector,
  useWindowSize,
} from '../../../hooks/index';

import styles from './popup.module.scss';
import { getExecutorPublicKey } from '@calimero-network/calimero-client';

interface IPopupProps {
  x: number;
  y: number;
  eventId: string;
}

const Popup: FC<IPopupProps> = ({ x, y, eventId }) => {
  const accountId = getExecutorPublicKey();
  const popupRef = useRef<HTMLDivElement>(null);
  const { events } = useTypedSelector(({ events }) => events);
  const { deleteEvent } = useActions();
  const { closePopup } = usePopup();
  const { openModalEdit, openErrorModal } = useModal();
  const { width: windowWidth, height: windowHeight } = useWindowSize();

  const getPopupStyle = () => {
    let popupHeight = 86;
    let popupWidth = 108;

    if (!!popupRef.current) {
      const { height, width } = getComputedStyle(popupRef.current);
      popupHeight = parseFloat(height);
      popupWidth = parseFloat(width);
    }

    const x2 = windowWidth - x - popupWidth;
    const y2 = windowHeight - y - popupHeight;

    const offsetX = x2 < 0 ? x - popupWidth : x;
    const offsetY = y2 < 0 ? y - popupHeight : y;

    const left = offsetX < 0 ? 0 : offsetX;
    const top = offsetY < 0 ? 0 : offsetY;

    return {
      left,
      top,
    };
  };

  const handleClosePopup = () => closePopup();

  useClickOutside(popupRef, handleClosePopup);

  const onDelete = () => {
    try {
      deleteEvent(eventId);
      closePopup();
    } catch (error: any) {
      openErrorModal({
        message: error.message,
        errorType: 'delete',
      });
    }
  };

  const handleOpenEditEventModal = () => {
    const eventData = events.find((event) => event.id === eventId);
    openModalEdit({ eventData, eventId: eventId });
    closePopup();
  };

  const [isOwner, setIsOwner] = useState(false);

  useEffect(() => {
    const eventData = events.find((event) => event.id === eventId);
    if (accountId === eventData?.owner) {
      setIsOwner(true);
    }
  }, [accountId, eventId]);

  return (
    <div className={styles.popup} ref={popupRef} style={getPopupStyle()}>
      {isOwner && (
        <button className={styles.btn__action} onClick={onDelete}>
          <span className="delete-event-btn__icon">
            <i className="fas fa-trash"></i>
          </span>
          <span className={styles.btn__action__text}>Delete</span>
        </button>
      )}
      <button className={styles.btn__action} onClick={handleOpenEditEventModal}>
        <span className="delete-event-btn__icon">
          {isOwner ? (
            <i className="fas fa-edit"></i>
          ) : (
            <i className="fas fa-eye"></i>
          )}
        </span>
        <span className={styles.btn__action__text}>
          {isOwner ? 'Edit' : 'View'}
        </span>
      </button>
    </div>
  );
};

export default Popup;
