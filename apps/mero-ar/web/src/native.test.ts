import { describe, expect, it } from "vitest";
import {
  NATIVE_INFO,
  b64url,
  bounceNativeConsent,
  captureNativeApproval,
  captureNativeSignIn,
  fromB64url,
  nativeReturnUrl,
  sealNativeSession,
  type NativeSession,
} from "./native";

const subtle = globalThis.crypto.subtle;
const ecdh = { name: "ECDH", namedCurve: "P-256" } as const;

/** What the Swift SDK's `ServedPageHandoff` does with a box: ECDH, HKDF, AES-GCM with the state as AD. */
async function openBox(privateKey: CryptoKey, state: string, box: string, info: string): Promise<unknown> {
  const raw = fromB64url(box);
  const epk = await subtle.importKey("raw", raw.slice(0, 65), ecdh, false, []);
  const shared = await subtle.deriveBits({ name: "ECDH", public: epk }, privateKey, 256);
  const hkdf = await subtle.importKey("raw", shared, "HKDF", false, ["deriveKey"]);
  const aes = await subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: new TextEncoder().encode(info) },
    hkdf,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"],
  );
  const plain = await subtle.decrypt(
    { name: "AES-GCM", iv: raw.slice(65, 77), additionalData: new TextEncoder().encode(state) },
    aes,
    raw.slice(77),
  );
  return JSON.parse(new TextDecoder().decode(plain));
}

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

describe("native sign-in", () => {
  it("seals the session so only the app's key opens it", async () => {
    const app = (await subtle.generateKey(ecdh, true, ["deriveBits"])) as CryptoKeyPair;
    const key = b64url(new Uint8Array(await subtle.exportKey("raw", app.publicKey)));
    const state = b64url(globalThis.crypto.getRandomValues(new Uint8Array(32)));
    const session: NativeSession = {
      v: 1,
      accountId: "acc",
      sessionToken: "tok",
      expiresAt: 1,
      refreshToken: "ref",
      nodeUrl: "https://node-1",
      nodes: ["https://node-2"],
    };
    const box = await sealNativeSession({ state, key }, session);
    expect(await openBox(app.privateKey, state, box, NATIVE_INFO)).toEqual(session);
    expect(nativeReturnUrl("mero-ar://signed-in", state, box)).toBe(`mero-ar://signed-in#state=${state}&box=${box}`);
  });

  it("captures a well-formed request and refuses a malformed one", async () => {
    const app = (await subtle.generateKey(ecdh, true, ["deriveBits"])) as CryptoKeyPair;
    const key = b64url(new Uint8Array(await subtle.exportKey("raw", app.publicKey)));
    const state = "s".repeat(24);
    const history = { replaceState: () => {} };
    const ok = captureNativeSignIn(
      { hash: `#native-sign-in&state=${state}&key=${key}`, pathname: "/0.0.1/", search: "" },
      memoryStorage(),
      history,
    );
    expect(ok).toEqual({ state, key });
    const bad = captureNativeSignIn(
      { hash: `#native-sign-in&state=short&key=${key}`, pathname: "/0.0.1/", search: "" },
      memoryStorage(),
      history,
    );
    expect(bad).toBeNull();
  });

  it("captures an approval with its challenge", () => {
    const key = b64url(new Uint8Array([4, ...new Uint8Array(64)]));
    const request = captureNativeApproval(
      {
        hash: `#native-approve&state=${"a".repeat(20)}&key=${key}&challenge=${"c".repeat(32)}&rpId=x.apps.calimero.network&allow=id1,id2`,
        pathname: "/0.0.1/",
        search: "",
      },
      { replaceState: () => {} },
    );
    expect(request?.rpId).toBe("x.apps.calimero.network");
    expect(request?.allow).toEqual(["id1", "id2"]);
  });
});

describe("consent returns", () => {
  it("passes the node's answer on to the app", () => {
    let went = "";
    const bounced = bounceNativeConsent(
      { search: "?native-consent=1&request_id=req_1&result=approved" },
      "mero-ar://consent",
      (url) => (went = url),
    );
    expect(bounced).toBe(true);
    expect(went).toBe("mero-ar://consent?request_id=req_1&result=approved");
  });

  it("leaves any other page alone", () => {
    expect(bounceNativeConsent({ search: "" }, "mero-ar://consent", () => {})).toBe(false);
  });
});
