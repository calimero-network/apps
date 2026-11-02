/** A key shortened for display when nothing has named it: `5926f2d2…1334`. */
export const formatKey = (k: string) => `${k.slice(0, 8)}…${k.slice(-4)}`;

export interface PlayerNameSources {
  /** account id -> the id it plays as (the account itself since the 1.0 port). */
  playerByAccount: Record<string, string>;
  /** This node's account, and the player key it plays under. */
  selfIdentity: string | null;
  executorPublicKey: string | null;
  /** The name an account set in the lobby's organization, if it has one. */
  nameOf?: (account: string) => string | undefined;
}

/** The account a player key belongs to, if the lobby knows it. */
export function accountForPlayerKey(key: string, s: PlayerNameSources): string | null {
  if (key === s.executorPublicKey && s.selfIdentity) return s.selfIdentity;
  const hit = Object.entries(s.playerByAccount).find(([, k]) => k === key);
  return hit?.[0] ?? null;
}

/**
 * What to call the player behind `key`: the name its account set in the
 * lobby's organization, else the shortened id.
 *
 * Matches and history record the id a player plays as, names are kept per
 * account; since the 1.0 port the two are the same id, and the map is the
 * identity.
 */
export function playerName(key: string, s: PlayerNameSources): string {
  const account = accountForPlayerKey(key, s);
  return (account && s.nameOf?.(account)) || formatKey(key);
}
