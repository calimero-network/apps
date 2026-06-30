import { IValidatorData } from "../../../../hooks/useValidator/types";
import { TEventTypes } from "../../../../types/event";

export interface IModalValues extends IValidatorData {
  title: string;
  startDate: Date;
  endDate: Date;
  // peers are a real string[] of base58 public keys (see types/event.ts bugfix)
  peers: string[];
  startTime: string;
  endTime: string;
  description: string;
  isLongEvent: boolean;
  // FEATURE: private events route through the *_private_event contract methods
  isPrivate: boolean;
  color: string;
  owner: string;
}

export interface IMapEventValues {
  title: string;
  description: string;
  startDate: Date;
  endDate: Date;
  peers: string[];
  type?: TEventTypes;
  color?: string;
  owner: string;
  isPrivate?: boolean;
}