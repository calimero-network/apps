import { FC } from "react";
import { getMapEventValues } from "../helpers";
import ModalFormEvent from "../modal-form-event/ModalFormEvent";
import { TPartialEvent } from "../../../../types/event";
import { useActions, useModal } from "../../../../hooks/index";
import { IModalEditEventOptions } from "../../../../store/modals/types";

const ModalEditEvent: FC<IModalEditEventOptions> = ({ eventData, eventId }) => {
  const { updateEvent } = useActions();
  const { closeModalEdit } = useModal();
  const startDate = new Date(eventData.start ?? Date.now());
  const endDate = new Date(eventData.end ?? Date.now());

  const defaultEventValues = getMapEventValues({
    title: eventData.title ?? "",
    description: eventData.description ?? "",
    peers: eventData.peers ?? [],
    startDate,
    endDate,
    type: eventData.type ?? "event",
    color: eventData.color,
    owner: eventData.owner ?? "",
    isPrivate: Boolean(eventData.private),
  });

  // Carry the event's private flag into the update so the data source routes to
  // the correct (shared vs private) contract method.
  const onUpdateEvent = (event: TPartialEvent) =>
    updateEvent({
      eventId,
      event: { ...event, private: Boolean(eventData.private) },
    });

  return (
    <ModalFormEvent
      textSendButton="Edit"
      textSendingBtn="Editing"
      defaultEventValues={defaultEventValues}
      // @ts-ignore — handlerSubmit returns the dispatched thunk (has .unwrap)
      handlerSubmit={onUpdateEvent}
      closeModal={closeModalEdit}
    />
  );
};

export default ModalEditEvent;
