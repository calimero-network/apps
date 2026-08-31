// Types for frame.mjs, so `src/lib/frameParity.test.ts` can import it under the
// app's tsconfig (which has `noImplicitAny`). The .mjs stays plain JS on purpose
// — it is imported directly by `node` in the merobox drivers, with no build step.
//
// These signatures mirror `src/lib/ephemeralFrames.ts`. They are NOT the parity
// guarantee: agreeing on types would not stop the two implementations writing
// different bytes, which is what the test actually compares.

export declare const EPHEMERAL_MAX_BYTES: number;
export declare const FRAME_VERSION: number;
export declare const HEADER_FIXED_BYTES: number;

export declare function maxPayloadBytes(codec: string): number;

export declare function encodeFragments(frame: {
  msgSeq: number;
  track?: number;
  isKeyframe: boolean;
  width: number;
  height: number;
  timestampUs: number;
  createdAtMs: number;
  startedAtMs: number;
  codec: string;
  bytes: Uint8Array;
}): Uint8Array[];

export interface DecodedHeader {
  msgSeq: number;
  track: number;
  isKeyframe: boolean;
  width: number;
  height: number;
  timestampUs: number;
  createdAtMs: number;
  startedAtMs: number;
  codec: string;
  fragIndex: number;
  fragCount: number;
  /** Offset the payload starts at, so a header-only prefix can be decoded. */
  payloadStart: number;
}

export declare function decodeHeader(slice: Uint8Array): DecodedHeader | null;
