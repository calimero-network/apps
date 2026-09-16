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
import { accountId } from '../../../api/identity';
import { EditIcon, EyeIcon, TrashIcon } from '../icons/Icons';

interface IPopupProps {
  x: number;
  y: number;
  eventId: string;
}

const Popup: FC<IPopupProps> = ({ x, y, eventId }) => {
  // ⚠️ The ACCOUNT, not the context signing key. `getContextIdentity()` used to
  // be read here, and it never once matched `event.owner` — the contract writes
  // `env::account_id()` there, and since core rc.27 both are 64 hex characters,
  // so the comparison was silently false for every event including your own.
  // Nobody ever saw Delete, and Edit always rendered as "View". See api/identity.
  const me = accountId();
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
    // Route deletion to the private vs shared contract method based on the event.
    const ev = events.find((e) => e.id === eventId);
    deleteEvent({ eventId, isPrivate: Boolean(ev?.private) });
    closePopup();
  };

  const handleOpenEditEventModal = () => {
    const eventData = events.find((event) => event.id === eventId);
    openModalEdit({ eventData, eventId: eventId });
    closePopup();
  };

  const [isOwner, setIsOwner] = useState(false);

  useEffect(() => {
    const eventData = events.find((event) => event.id === eventId);
    // `me` is "" when the identity route could not be read, and an owner is
    // never "", so an unknown account degrades to owning NOTHING rather than
    // everything. The contract refuses a non-owner either way.
    setIsOwner(Boolean(me) && me === eventData?.owner);
  }, [me, eventId, events]);

  return (
    <div className={styles.popup} ref={popupRef} style={getPopupStyle()}>
      {isOwner && (
        <button
          className={styles.btn__action}
          onClick={onDelete}
          data-testid="popup-delete"
        >
          <span className={styles.btn__action__icon}>
            <TrashIcon />
          </span>
          <span className={styles.btn__action__text}>Delete</span>
        </button>
      )}
      <button
        className={styles.btn__action}
        onClick={handleOpenEditEventModal}
        data-testid={isOwner ? 'popup-edit' : 'popup-view'}
      >
        <span className={styles.btn__action__icon}>
          {isOwner ? <EditIcon /> : <EyeIcon />}
        </span>
        <span className={styles.btn__action__text}>
          {isOwner ? 'Edit' : 'View'}
        </span>
      </button>
    </div>
  );
};

export default Popup;
