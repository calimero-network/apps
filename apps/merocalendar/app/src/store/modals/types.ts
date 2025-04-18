import { TEventTypes, TPartialEvent } from '../../types/event';

export interface IModalsState {
  isOpenModalEditEvent: boolean;
  isOpenModalCreateEvent: boolean;
  isOpenModalDayInfoEvents: boolean;
  modalCreateEventOptions: IModalCreateEventOptions | null;
  modalEditEventOptions: IModalEditEventOptions | null;
  selectedDate: Date | null;
  isOpenErrorModal: boolean;
  errorModalOptions: IErrorModalOptions | null;
}

export interface IModalCreateEventOptions {
  selectedDate: Date;
  type?: TEventTypes;
}

export interface IModalEditEventOptions {
  eventData: TPartialEvent;
  eventId: string;
}

export interface IErrorModalOptions {
  message: string;
  type: 'websocket' | 'create' | 'edit' | 'delete' | 'appError';
}
