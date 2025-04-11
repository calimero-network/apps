export interface IEvent {
    id: string;
    title: string;
    description: string;
    start: string;
    peers: string;
    end: string;
    type: TEventTypes;
    color: string;
    owner: string;
  }
  
  export type TPartialEvent = Partial<IEvent>;
  
  export interface IEventCreate {
    title: string;
    description: string;
    start: string;
    peers: string;
    end: string;
    type: TEventTypes;
    color: string;
    owner: string;
  }
  
  export type TEventTypes = 'event' | 'long-event';