export interface IEvent {
  id: string;
  title: string;
  description: string;
  start: string;
  // BUGFIX (peers collapse on edit): peers are a real `string[]` of account
  // ids end-to-end now. The old code round-tripped them through a
  // single string joined with ',' but split on ', ', which silently merged all
  // peers into one on edit. The contract takes/returns `peers: string[]`, so we
  // keep them as an array everywhere.
  peers: string[];
  end: string;
  type: TEventTypes;
  color: string;
  owner: string;
  // A private event: the owner's own, read by nobody else. Routed to the
  // *PrivateEvent contract methods. Shared events have private:false.
  private: boolean;
}

export type TPartialEvent = Partial<IEvent>;

export interface IEventCreate {
  title: string;
  description: string;
  start: string;
  peers: string[];
  end: string;
  type: TEventTypes;
  color: string;
  owner: string;
  private: boolean;
}

export type TEventTypes = "event" | "long-event";

/** A member, from the contract's `getMembers()` (u64s converted back to numbers). */
export interface Member {
  id: string; // the account id
  username: string;
  joinedAt: number;
  usernameUpdatedAt: number;
}
