/** A key shortened for display when nothing has named it: `5926f2d2…1334`. */
export const formatKey = (k: string) => `${k.slice(0, 8)}…${k.slice(-4)}`;

export interface PlayerNameSources {
  /** account id -> player key, as recorded in the lobby contract. */
  playerByAccount: Record<string, string>;
  /** This node's account, and the player key it plays under. */
  selfIdentity: string | null;
  executorPublicKey: string | null;
  /** The namespace name for an account, if it has one. */
  nameOf?: (account: string) => string | undefined;
}

/** The account a player key belongs to, if the lobby knows it. */
export function accountForPlayerKey(key: string, s: PlayerNameSources): string | null {
  if (key === s.executorPublicKey && s.selfIdentity) return s.selfIdentity;
  const hit = Object.entries(s.playerByAccount).find(([, k]) => k === key);
  return hit?.[0] ?? null;
}

/**
 * What to call the player behind `key`: the name its account set for the
 * namespace, else the shortened key.
 *
 * Matches and history record PLAYER keys (context identities), while names
 * are kept per ACCOUNT, so the key goes through the lobby's `register_player`
 * map first.
 */
export function playerName(key: string, s: PlayerNameSources): string {
  const account = accountForPlayerKey(key, s);
  return (account && s.nameOf?.(account)) || formatKey(key);
}
