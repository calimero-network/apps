/**
 * The BIP39 English wordlist, verbatim — 2048 words, index order significant.
 *
 * Vendored rather than depended on because this package ships with no runtime
 * dependencies, and a recovery phrase is useless if the list it was written
 * against is not the one everybody else implements. The list is content-checked
 * in `account.test.ts` against its canonical SHA-256
 * (`2f5eed53a4727b4bf8880d8f3f199efc90e58503646d9ff8eff3a2ed3b24dbda` over the
 * newline-joined, newline-terminated file), so a stray edit here fails the suite
 * instead of silently minting phrases no other wallet can restore.
 *
 * Its own module so bundlers can drop it: nothing outside `account/` imports it,
 * and the package is `sideEffects: false`, so a consumer who only signs never
 * pays for the ~13 KB.
 */
export declare const ENGLISH_WORDLIST: readonly string[];
