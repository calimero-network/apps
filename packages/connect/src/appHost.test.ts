import { describe, expect, it } from "vitest";

import { APPS_DOMAIN, appLabel, appUrl, sha256 } from "./appHost";

describe("appLabel", () => {
  // Computed with mdma's `mdma_common.app_host.label` (Python hashlib + base64);
  // `com.calimero.kv` is also the vector core's `app_host::label` test pins.
  const vectors: Record<string, string> = {
    "com.calimero.kv": "7pysax5oylhat255idekdoknnceibzxygvjbceej2umvlmpwx2aa",
    "com.calimero.kv-store": "2g7omgwwdshuse6hygzvhssf4w3ute5zc3vjlpor7zknkoyrwxdq",
    "com.calimero.mero-blocks": "k3fyuodnomq2d2i3woo47t6blm42ur6mfy4icg4rsaxtkujph2vq",
    "com.calimero.chat": "pjfzih7fgm2e33figvvm2hcvlbr3egcxy3jjn6zhuzdlxkz4hfdq",
  };

  it.each(Object.entries(vectors))("matches core and mdma for %s", (pkg, label) => {
    expect(appLabel(pkg)).toBe(label);
  });

  it("is 52 lowercase base32 characters, one per package", () => {
    const a = appLabel("com.calimero.mero-chess");
    expect(a).toMatch(/^[a-z2-7]{52}$/);
    expect(a).not.toBe(appLabel("com.calimero.mero-kombat"));
  });

  it("builds the node-served URL on the shared apps domain", () => {
    expect(APPS_DOMAIN).toBe("apps.calimero.network");
    expect(appUrl("com.calimero.kv-store")).toBe(
      "https://2g7omgwwdshuse6hygzvhssf4w3ute5zc3vjlpor7zknkoyrwxdq.apps.calimero.network/",
    );
    expect(appUrl("com.calimero.kv", ".Apps.Example.")).toBe(`https://${vectors["com.calimero.kv"]}.apps.example/`);
  });
});

describe("sha256", () => {
  const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  const utf8 = (s: string) => new TextEncoder().encode(s);

  it("matches the FIPS 180-4 examples, across block boundaries", () => {
    expect(hex(sha256(utf8("")))).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(hex(sha256(utf8("abc")))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(hex(sha256(utf8("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")))).toBe(
      "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
    );
    expect(hex(sha256(utf8("a".repeat(1000))))).toBe(
      "41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3",
    );
  });
});
