import React, { FC } from "react";
import { ModalCreateEvent, ModalDayInfo, ModalEditEvent } from "../../components/common/modals";
import { useModal } from "../../hooks/useModal";

export const ModalProvider: FC<{ children: React.ReactNode }> = ({ children }) => {
  const {
    isOpenModalCreateEvent,
    isOpenModalEditEvent,
    isOpenModalDayInfoEvents,
    selectedDate,
    modalEditEventOptions,
    modalCreateEventOptions
  } = useModal();

  return (
    <>
      {isOpenModalCreateEvent && (
        <ModalCreateEvent {...modalCreateEventOptions} />
      )}
      {isOpenModalEditEvent && (
        <ModalEditEvent {...modalEditEventOptions} />
      )}
      {isOpenModalDayInfoEvents && (
        <ModalDayInfo selectedDate={selectedDate} />
      )}
      {children}
    </>
  );
};
