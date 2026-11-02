// @vitest-environment node
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";

import { base58, jcs, publisher, signedMpk, signedPayload, variant } from "./mpk";

/** The entries of a ustar archive. */
function untar(data: Uint8Array): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>();
  let at = 0;
  const dec = new TextDecoder();
  while (at + 512 <= data.length) {
    const h = data.subarray(at, at + 512);
    if (h.every((b) => b === 0)) break;
    const name = dec.decode(h.subarray(0, 100)).replace(/\0.*$/s, "");
    const size = parseInt(dec.decode(h.subarray(124, 135)), 8);
    out.set(name, data.slice(at + 512, at + 512 + size));
    at += 512 + Math.ceil(size / 512) * 512;
  }
  return out;
}

const b64 = (s: string) => new Uint8Array(Buffer.from(s, "base64url"));

describe("the package signer", () => {
  it("encodes base58 and canonical JSON as core reads them", () => {
    expect(base58(new Uint8Array([0, 0, 1]))).toBe("112");
    expect(jcs({ b: 1, a: [true, "x"], c: { z: null, y: 2 } })).toBe('{"a":[true,"x"],"b":1,"c":{"y":2,"z":null}}');
  });

  it("packs the component and a manifest whose signature verifies", async () => {
    const wasm = new Uint8Array([0, 0x61, 0x73, 0x6d, 13, 0, 1, 0, 9, 9]);
    const key = await publisher();
    expect(key.signerId).toMatch(/^did:key:z6Mk/);
    const files = untar(new Uint8Array(gunzipSync(await signedMpk("com.example.x", "1.2.3", wasm, key, "1.0.0-rc.8"))));
    expect([...files.keys()]).toEqual(["manifest.json", "app.wasm"]);
    expect(files.get("app.wasm")).toEqual(wasm);
    const manifest = JSON.parse(new TextDecoder().decode(files.get("manifest.json"))) as Record<string, unknown> & {
      signature: { algorithm: string; publicKey: string; signature: string };
      wasm: { size: number; hash: string };
    };
    expect(manifest).toMatchObject({
      package: "com.example.x",
      appVersion: "1.2.3",
      signerId: key.signerId,
      minRuntimeVersion: "1.0.0-rc.8",
      wasm: { path: "app.wasm", size: wasm.length },
    });
    const { signature, ...unsigned } = manifest;
    const pub = await crypto.subtle.importKey("raw", b64(signature.publicKey), { name: "Ed25519" }, false, ["verify"]);
    const payload = await signedPayload(unsigned);
    expect(await crypto.subtle.verify({ name: "Ed25519" }, pub, b64(signature.signature), payload as BufferSource)).toBe(true);
  });

  it("makes a variant that differs only by a trailing custom section", () => {
    const wasm = new Uint8Array([0, 0x61, 0x73, 0x6d]);
    const v = variant(wasm, "v1");
    expect([...v]).toEqual([0, 0x61, 0x73, 0x6d, 0, 3, 2, 0x76, 0x31]);
    expect(variant(wasm, "v2")).not.toEqual(v);
  });
});
