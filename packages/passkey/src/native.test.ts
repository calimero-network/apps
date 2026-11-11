// @vitest-environment node
import {
  NATIVE_APPROVE_INFO,
  NATIVE_INFO,
  approveNative,
  captureNativeApproval,
  declineNative,
  pendingNativeApproval,
  validApprovalRequest,
  type NativeAssertion,
  NATIVE_STORAGE_KEY,
  b64url,
  captureNativeSignIn,
  dropNativeSignIn,
  finishNativeSignIn,
  fromB64url,
  pendingNativeSignIn,
  sealNativeSession,
  validRequest,
  type NativeRequest,
  type NativeSession,
} from "./native";

const crypto = globalThis.crypto;
const subtle = crypto.subtle;
const ecdh = { name: "ECDH", namedCurve: "P-256" } as const;

function memory(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  } as Storage;
}

async function appKeyPair(): Promise<{ pair: CryptoKeyPair; key: string }> {
  const pair = (await subtle.generateKey(ecdh, true, ["deriveBits"])) as CryptoKeyPair;
  return { pair, key: b64url(new Uint8Array(await subtle.exportKey("raw", pair.publicKey))) };
}

/** What the SDKs do: the reference opener. */
async function open<T = NativeSession>(box: string, state: string, priv: CryptoKey, info = NATIVE_INFO): Promise<T> {
  const bytes = fromB64url(box);
  const epk = await subtle.importKey("raw", bytes.slice(0, 65), ecdh, false, []);
  const shared = await subtle.deriveBits({ name: "ECDH", public: epk }, priv, 256);
  const hkdf = await subtle.importKey("raw", shared, "HKDF", false, ["deriveKey"]);
  const aes = await subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: new TextEncoder().encode(info) },
    hkdf,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"],
  );
  const plain = await subtle.decrypt(
    { name: "AES-GCM", iv: bytes.slice(65, 77), additionalData: new TextEncoder().encode(state) },
    aes,
    bytes.slice(77),
  );
  return JSON.parse(new TextDecoder().decode(plain)) as T;
}

const SESSION: NativeSession = {
  v: 1,
  accountId: "acc_1",
  sessionToken: "v2.claims.sig",
  expiresAt: 1_900_000_000,
  refreshToken: "rt_1",
  nodeUrl: "https://n1.example",
  nodes: ["https://n2.example"],
};
const STATE = "c3RhdGUtZm9yLXRoaXMtc2lnbi1pbg";

describe("native sign-in", () => {
  beforeEach(() => dropNativeSignIn(memory()));

  it("seals a session only the app's key opens, bound to the state", async () => {
    const { pair, key } = await appKeyPair();
    const request: NativeRequest = { state: STATE, key };
    const box = await sealNativeSession(request, SESSION, crypto);
    expect(await open(box, STATE, pair.privateKey)).toEqual(SESSION);
    await expect(open(box, STATE + "x", pair.privateKey)).rejects.toThrow();
    const other = await appKeyPair();
    await expect(open(box, STATE, other.pair.privateKey)).rejects.toThrow();
  });

  it("refuses a malformed key or state", async () => {
    const { key } = await appKeyPair();
    expect(validRequest({ state: STATE, key })).toEqual({ state: STATE, key });
    expect(validRequest({ state: "short", key })).toBeNull();
    expect(validRequest({ state: STATE, key: key.slice(0, 40) })).toBeNull();
    expect(validRequest({ state: STATE, key: b64url(new Uint8Array(65)) })).toBeNull();
    expect(validRequest({ state: "has spaces in it......", key })).toBeNull();
  });

  it("captures the fragment, clears the address bar, and ignores other pages", async () => {
    const { key } = await appKeyPair();
    const storage = memory();
    const replaced: string[] = [];
    const history = { replaceState: (_: unknown, __: string, url: string) => void replaced.push(url) };
    const got = captureNativeSignIn(
      { hash: `#native-sign-in&state=${STATE}&key=${key}`, pathname: "/1.2.0/", search: "" },
      storage,
      history,
    );
    expect(got).toEqual({ state: STATE, key });
    expect(replaced).toEqual(["/1.2.0/"]);
    expect(pendingNativeSignIn(storage)).toEqual({ state: STATE, key });

    const plain = memory();
    expect(captureNativeSignIn({ hash: "#other", pathname: "/", search: "" }, plain, history)).toBeNull();
    expect(plain.getItem(NATIVE_STORAGE_KEY)).toBeNull();
  });

  it("keeps the request when the page clears its storage before signing in", async () => {
    const { key } = await appKeyPair();
    const storage = memory();
    const history = { replaceState: () => {} };
    captureNativeSignIn({ hash: `#native-sign-in&state=${STATE}&key=${key}`, pathname: "/", search: "" }, storage, history);
    storage.removeItem(NATIVE_STORAGE_KEY); // e.g. sessionStorage.clear() before the ceremony
    expect(pendingNativeSignIn(storage)).toEqual({ state: STATE, key });
    dropNativeSignIn(storage);
    expect(pendingNativeSignIn(storage)).toBeNull();
  });

  it("hands the session to the app's own callback and forgets it here", async () => {
    const { pair, key } = await appKeyPair();
    const storage = memory();
    storage.setItem(NATIVE_STORAGE_KEY, JSON.stringify({ state: STATE, key }));
    let went = "";
    let forgot = false;
    const done = await finishNativeSignIn({
      client: {
        session: { accountId: "acc_1", sessionToken: "v2.claims.sig", expiresAt: 1_900_000_000, refreshToken: "rt_1" },
        nodeUrl: "https://n1.example",
        nodes: ["https://n1.example", "https://n2.example"],
      },
      callback: "mero-chat://signed-in",
      forgetHere: () => (forgot = true),
      go: (url) => (went = url),
      storage,
      crypto,
    });
    expect(done).toBe(true);
    expect(forgot).toBe(true);
    expect(pendingNativeSignIn(storage)).toBeNull();
    const url = new URL(went);
    expect(`${url.protocol}//${url.host}`).toBe("mero-chat://signed-in");
    const params = new URLSearchParams(url.hash.slice(1));
    expect(params.get("state")).toBe(STATE);
    expect(await open(params.get("box")!, STATE, pair.privateKey)).toEqual(SESSION);
  });

  it("does nothing without a request", async () => {
    const done = await finishNativeSignIn({
      client: { session: undefined, nodeUrl: "", nodes: [] },
      callback: "mero-chat://signed-in",
      forgetHere: () => {
        throw new Error("must not forget");
      },
      go: () => {
        throw new Error("must not navigate");
      },
      storage: memory(),
      crypto,
    });
    expect(done).toBe(false);
  });
});

describe("native approval", () => {
  const CHALLENGE = b64url(new Uint8Array(32).fill(7));
  const ASSERTION: NativeAssertion = {
    credentialId: "cred_1",
    authenticatorData: "ad",
    clientDataJson: "cd",
    signature: "sig",
  };
  const nowhere = { replaceState: () => {} };

  it("signs the node's challenge and seals the assertion to the app's key", async () => {
    const { pair, key } = await appKeyPair();
    const request = captureNativeApproval(
      { hash: `#native-approve&state=${STATE}&key=${key}&challenge=${CHALLENGE}&rpId=calimero.network&allow=cred_1,cred_2`, pathname: "/", search: "" },
      nowhere,
    );
    expect(request).toEqual({ state: STATE, key, challenge: CHALLENGE, rpId: "calimero.network", allow: ["cred_1", "cred_2"] });
    let signed: { challenge: Uint8Array; rpId: string; allow?: string[] } | null = null;
    let went = "";
    const done = await approveNative({
      approver: {
        get: async (challenge, rpId, allow) => {
          signed = { challenge, rpId, allow };
          return ASSERTION;
        },
      },
      callback: "mero-chat://approved",
      go: (url) => (went = url),
      crypto,
    });
    expect(done).toBe(true);
    expect(signed!.rpId).toBe("calimero.network");
    expect(signed!.allow).toEqual(["cred_1", "cred_2"]);
    expect(b64url(signed!.challenge)).toBe(CHALLENGE);
    expect(pendingNativeApproval()).toBeNull();
    const url = new URL(went);
    expect(`${url.protocol}//${url.host}`).toBe("mero-chat://approved");
    const params = new URLSearchParams(url.hash.slice(1));
    expect(params.get("state")).toBe(STATE);
    const opened = await open<{ v: number; assertion: NativeAssertion }>(params.get("box")!, STATE, pair.privateKey, NATIVE_APPROVE_INFO);
    expect(opened).toEqual({ v: 1, assertion: ASSERTION });
    // A sign-in's opener can't read it: the boxes don't mix.
    await expect(open(params.get("box")!, STATE, pair.privateKey)).rejects.toThrow();
  });

  it("refuses a malformed request", async () => {
    const { key } = await appKeyPair();
    expect(validApprovalRequest({ state: STATE, key, challenge: "short", rpId: "calimero.network", allow: [] })).toBeNull();
    expect(validApprovalRequest({ state: STATE, key, challenge: CHALLENGE, rpId: "Evil Host/", allow: [] })).toBeNull();
    expect(validApprovalRequest({ state: STATE, key, challenge: CHALLENGE, rpId: "calimero.network", allow: ["no spaces"] })).toBeNull();
    expect(validApprovalRequest({ state: STATE, key: "AAAA", challenge: CHALLENGE, rpId: "calimero.network", allow: [] })).toBeNull();
    expect(captureNativeApproval({ hash: "#native-sign-in&state=x", pathname: "/", search: "" }, nowhere)).toBeNull();
  });

  it("tells the app when the person declines", async () => {
    const { key } = await appKeyPair();
    captureNativeApproval(
      { hash: `#native-approve&state=${STATE}&key=${key}&challenge=${CHALLENGE}&rpId=calimero.network`, pathname: "/", search: "" },
      nowhere,
    );
    let went = "";
    declineNative({ callback: "mero-chat://approved", go: (url) => (went = url) });
    expect(went).toBe(`mero-chat://approved#state=${STATE}&cancelled=1`);
    expect(pendingNativeApproval()).toBeNull();
  });
});
