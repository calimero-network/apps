import React, { FC } from 'react';
import {
  ModalCreateEvent,
  ModalDayInfo,
  ModalEditEvent,
} from '../../components/common/modals';
import { useModal } from '../../hooks/useModal';
import ErrorModal from '../../components/common/error-modal/ErrorModal';

export const ModalProvider: FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const {
    isOpenModalCreateEvent,
    isOpenModalEditEvent,
    isOpenModalDayInfoEvents,
    selectedDate,
    modalEditEventOptions,
    modalCreateEventOptions,
    isOpenErrorModal,
    errorModalOptions,
    closeErrorModal,
  } = useModal();

  return (
    <>
      {isOpenModalCreateEvent && (
        <ModalCreateEvent {...modalCreateEventOptions} />
      )}
      {isOpenModalEditEvent && <ModalEditEvent {...modalEditEventOptions} />}
      {isOpenModalDayInfoEvents && <ModalDayInfo selectedDate={selectedDate} />}
      {isOpenErrorModal && (
        <ErrorModal {...errorModalOptions} closeError={closeErrorModal} />
      )}
      {children}
    </>
  );
};
