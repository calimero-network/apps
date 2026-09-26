import bs58 from "bs58";

/**
 * mero-chat's contract serializes `UserId` as BASE58 (logic/src/types/id.rs,
 * `id::define!(UserId<32, 44>)`), while every admin route speaks 64-char hex.
 * A message's `sender`, a reaction's reactors, a profile's `identity` and a
 * mention all come back — and must go in — as base58 of the ACCOUNT.
 */
export function accountB58(hex: string | undefined): string {
  if (!hex || !/^[0-9a-f]{64}$/i.test(hex)) return "";
  return bs58.encode(Uint8Array.from(hex.match(/../g)!.map((b) => parseInt(b, 16))));
}

/** Alice's (node 1) and Bob's (node 2) accounts, as the contract spells them. */
export const aliceB58 = () => accountB58(process.env.E2E_ACCOUNT_ID);
export const bobB58 = () => accountB58(process.env.E2E_ACCOUNT_ID_2);
