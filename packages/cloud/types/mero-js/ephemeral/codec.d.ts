import type { Codec } from './types.js';
/** Default codec: JSON text as a byte array. The wire carries `state` as
 * `number[]`, not a string, so this encodes to bytes rather than to text. */
export declare function jsonCodec<T>(): Codec<T>;
