export interface IEvent {
  id: string;
  title: string;
  description: string;
  start: string;
  // BUGFIX (peers collapse on edit): peers are a real `string[]` of base58
  // public keys end-to-end now. The old code round-tripped them through a
  // single string joined with ',' but split on ', ', which silently merged all
  // peers into one on edit. The contract takes/returns `peers: string[]`, so we
  // keep them as an array everywhere.
  peers: string[];
  end: string;
  type: TEventTypes;
  color: string;
  owner: string;
  // FEATURE (private events): node-local events that never sync to peers. Routed
  // to the *_private_event contract methods. Shared events have private:false.
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

/** A team member, resolved from the contract's `get_members()` (camelCase). */
export interface Member {
  id: string; // base58 public key
  username: string;
  joinedAt: number;
  usernameUpdatedAt: number;
}
