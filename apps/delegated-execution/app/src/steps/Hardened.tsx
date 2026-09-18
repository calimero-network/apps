/**
 * The same flow, with the account root outside the browser and the device key
 * unreadable by it.
 *
 * The panels above this one are the demo as it shipped: an account root minted
 * in the tab and kept in `localStorage`, next to a device secret in the same
 * place. Both of those files say, in as many words, that a product must not do
 * that. This section is the other half of the sentence — the same four legs,
 * with the two secrets removed:
 *
 * | | the panels above | here |
 * | --- | --- | --- |
 * | account root | generated in the tab, kept in `localStorage` | never in the browser; a CLI holding it signs the certificate |
 * | device key | a hex secret in `localStorage` | a non-extractable `CryptoKey` in IndexedDB |
 * | warrant, login statement | mero-js, from that hex secret | reproduced here against the key |
 *
 * Both paths are kept because the contrast is the subject. Deleting the
 * original would leave a page asserting that the compromise used to exist.
 *
 * ## What this still does not fix
 *
 * Script injected into this origin can *use* the key for as long as the page is
 * open — it can spend warrants and open sessions. That is the residual the
 * design accepts and cannot remove, because a key usable by the page is usable
 * by anything running as the page. What it removes is exfiltration: the
 * attacker cannot walk away with the identity, and revoking the device ends it.
 * A stolen hex secret, by contrast, is the account until the root revokes it.
 */

import { useCallback, useEffect, useState } from 'react';

import { Out, Step } from './Step.js';
import {
  deviceHandle,
  enrolled,
  forgetDevice,
  recordEnrollment,
  type DeviceHandle,
  type EnrolledDevice,
} from '../lib/device.js';
import { openSession, type DelegatedSession } from '../lib/login.js';
import { describeRelay, writeContext } from '../lib/relay.js';
import { readContext } from '../lib/flow.js';
import { errorText, parseJson, pretty, short } from '../lib/format.js';
import type { Settings } from '../lib/storage.js';

/** The same three-state reporting the panels above use. */
function useOutcome() {
  const [outcome, setOutcome] = useState<{ text: string; error: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  const run = useCallback(async (fn: () => Promise<string>) => {
    setBusy(true);
    setOutcome(null);
    try {
      setOutcome({ text: await fn(), error: false });
    } catch (err) {
      setOutcome({ text: errorText(err), error: true });
    } finally {
      setBusy(false);
    }
  }, []);

  return { outcome, busy, run };
}

export function HardenedPath({ settings }: { settings: Settings }) {
  const [handle, setHandle] = useState<DeviceHandle | null>(null);
  const [device, setDevice] = useState<EnrolledDevice | null>(null);
  const [session, setSession] = useState<DelegatedSession | null>(null);

  // IndexedDB is async and unavailable during SSR, so the handle is loaded in
  // an effect rather than in a `useState` initialiser — the same reason the
  // panels above load `localStorage` that way.
  useEffect(() => {
    void enrolled().then(setDevice);
  }, []);

  return (
    <>
      <EnrollStep
        handle={handle}
        device={device}
        onHandle={setHandle}
        onDevice={(next) => {
          setDevice(next);
          // A different device invalidates the session: the token names the old
          // key. Keeping it would produce a read that succeeds as somebody
          // else, which is the most misleading thing this page could do.
          setSession(null);
        }}
        onForget={() => {
          setHandle(null);
          setDevice(null);
          setSession(null);
        }}
      />
      <HardenedSessionStep
        settings={settings}
        device={device}
        handle={handle}
        session={session}
        onSession={setSession}
        onHandle={setHandle}
      />
      <HardenedReadStep settings={settings} session={session} />
      <HardenedWriteStep settings={settings} device={device} handle={handle} onHandle={setHandle} />
    </>
  );
}

/**
 * Generate a key the page cannot read, and take back a certificate for it.
 *
 * The certificate is minted somewhere else on purpose. A root in the browser
 * was the compromise, and making it non-extractable would not fix it — a
 * certificate has to be signed where the root actually is. So this panel emits
 * a public key and a command, and what comes back carries no secret and is
 * public by construction.
 */
function EnrollStep({
  handle,
  device,
  onHandle,
  onDevice,
  onForget,
}: {
  handle: DeviceHandle | null;
  device: EnrolledDevice | null;
  onHandle: (handle: DeviceHandle) => void;
  onDevice: (device: EnrolledDevice) => void;
  onForget: () => void;
}) {
  const { outcome, busy, run } = useOutcome();
  const [credential, setCredential] = useState('');
  const [accountId, setAccountId] = useState('');
  const [deviceId, setDeviceId] = useState('');

  return (
    <Step
      n={7}
      title="Enrol a device key this page cannot read"
      state={device ? 'done' : 'idle'}
      stateLabel={device ? 'enrolled' : handle ? 'key held, uncertified' : 'none yet'}
      why={
        <>
          The key is generated with <code>extractable: false</code> and stored in IndexedDB
          as a <code>CryptoKey</code>, so it never exists as bytes in script memory and
          cannot be exported — by this page or by anything injected into it. What leaves is
          a <strong>public</strong> key. The account root that certifies it lives in a CLI,
          not here, which is the difference between this panel and step&nbsp;1.
        </>
      }
    >
      {handle ? (
        <dl className="kv">
          <dt>device key</dt>
          <dd>{handle.devicePublicKey}</dd>
          <dt>delivery key</dt>
          <dd>{short(handle.kemPublicKey, 12)}</dd>
        </dl>
      ) : null}

      <div className="row">
        <button
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const next = await deviceHandle();
              onHandle(next);
              return `holding a non-extractable key — ${short(next.devicePublicKey, 12)}`;
            })
          }
        >
          {handle ? 'Show this browser’s key' : 'Generate a device key'}
        </button>
        {device ? (
          <button
            className="secondary"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await forgetDevice();
                onForget();
                return 'device forgotten — the key is gone and cannot be recovered';
              })
            }
          >
            Forget this device
          </button>
        ) : null}
      </div>

      {handle ? (
        <>
          <p className="aside">
            Run this where the account root is. It mints a <code>DeviceId</code>, signs a{' '}
            <code>DeviceCert</code> and prints the <code>AccountProof</code> to paste back —
            the root never touches this machine’s browser:
          </p>
          <pre className="phrase">
            {`certifier certify --key account.key \\\n  --device-key ${handle.devicePublicKey} \\\n  --kem-key ${handle.kemPublicKey}`}
          </pre>
        </>
      ) : null}

      <label>
        Account id — 64 hex, as <code>certifier</code> printed it
        <input type="text" value={accountId} onChange={(e) => setAccountId(e.target.value.trim())} />
      </label>
      <label>
        Device id — 64 hex
        <input type="text" value={deviceId} onChange={(e) => setDeviceId(e.target.value.trim())} />
      </label>
      <label>
        Credential — the hex <code>AccountProof&lt;DeviceCert&gt;</code>
        <textarea rows={4} value={credential} onChange={(e) => setCredential(e.target.value.trim())} />
      </label>

      <div className="row">
        <button
          disabled={busy || !handle || credential === ''}
          onClick={() =>
            void run(async () => {
              if (!handle) throw new Error('generate a device key first');
              const next: EnrolledDevice = {
                accountId,
                deviceId,
                devicePublicKey: handle.devicePublicKey,
                credential,
              };
              // Refuses a credential for a different key. A certificate naming
              // some other device verifies perfectly and vouches for a key this
              // browser cannot sign with — which surfaces much later, as an
              // unspendable warrant.
              await recordEnrollment(next);
              onDevice(next);
              return `enrolled ${short(accountId, 10)} — ${credential.length / 2} bytes of certificate`;
            })
          }
        >
          Record this credential
        </button>
      </div>

      {device ? (
        <dl className="kv">
          <dt>account</dt>
          <dd>{device.accountId}</dd>
          <dt>device</dt>
          <dd>{short(device.deviceId, 12)}</dd>
        </dl>
      ) : null}

      <Out error={outcome?.error}>{outcome?.text ?? ''}</Out>
    </Step>
  );
}

function HardenedSessionStep({
  settings,
  device,
  handle,
  session,
  onSession,
  onHandle,
}: {
  settings: Settings;
  device: EnrolledDevice | null;
  handle: DeviceHandle | null;
  session: DelegatedSession | null;
  onSession: (session: DelegatedSession | null) => void;
  onHandle: (handle: DeviceHandle) => void;
}) {
  const { outcome, busy, run } = useOutcome();

  return (
    <Step
      n={8}
      title="Obtain a session — signed by a key nothing can export"
      state={session ? 'done' : 'idle'}
      stateLabel={session ? 'open' : 'closed'}
      why={
        <>
          The same three legs as step&nbsp;4 — challenge, statement, token — with the
          statement signed by the <code>CryptoKey</code> rather than by a hex secret.
          mero-js cannot do this: every entry point it exposes takes the secret as 32 hex
          bytes, so the statement is reproduced in <code>lib/login.ts</code> and pinned to
          core’s vectors. The audience is this origin, compared byte for byte.
        </>
      }
    >
      {session ? (
        <dl className="kv">
          <dt>token</dt>
          <dd>{short(session.accessToken, 14)}</dd>
          <dt>session key</dt>
          <dd>{short(session.sessionKey, 12)}</dd>
          <dt>audience</dt>
          <dd>{window.location.origin}</dd>
        </dl>
      ) : null}

      <div className="row">
        <button
          disabled={busy || !device}
          onClick={() =>
            void run(async () => {
              if (!device) throw new Error('enrol a device in step 7 first');
              // The handle may not be in state on a returning visit: the device
              // record loads from IndexedDB on mount, the key itself does not.
              const key = handle ?? (await deviceHandle());
              if (!handle) onHandle(key);
              const opened = await openSession(settings.nodeUrl, settings.nodeKey, device, key);
              onSession(opened);
              return 'session minted from a statement signed by an unexportable key';
            })
          }
        >
          Open a session
        </button>
        {session ? (
          <button className="secondary" disabled={busy} onClick={() => onSession(null)}>
            Drop it
          </button>
        ) : null}
      </div>

      <Out error={outcome?.error}>{outcome?.text ?? ''}</Out>

      {outcome?.error ? (
        <div className="note">
          A 401 is the same three things as step&nbsp;4 — the audience (
          <code>{window.location.origin}</code>) missing from{' '}
          <code>allowed_audiences</code>, the wrong node key, or the provider off — plus one
          more that is specific to this path: a credential signed by a root whose account is
          not a member of the group.
        </div>
      ) : null}
    </Step>
  );
}

function HardenedReadStep({
  settings,
  session,
}: {
  settings: Settings;
  session: DelegatedSession | null;
}) {
  const { outcome, busy, run } = useOutcome();
  const [key, setKey] = useState('delegated');

  return (
    <Step
      n={9}
      title="Read with that session"
      why={
        <>
          Identical to step&nbsp;5 — the token is an ordinary bearer token whatever key
          signed for it. That is the point worth seeing: the node's read path is unchanged,
          so hardening the client costs the server nothing.
        </>
      }
    >
      <label>
        Key to read — <code>get(key)</code>
        <input type="text" value={key} onChange={(e) => setKey(e.target.value)} />
      </label>

      <div className="row">
        <button
          disabled={busy || !session}
          onClick={() =>
            void run(async () => {
              if (!session) throw new Error('open a session in step 8 first');
              const result = await readContext(
                settings.nodeUrl,
                session,
                settings.contextId,
                'get',
                { key },
              );
              return pretty(result.raw);
            })
          }
        >
          Read
        </button>
      </div>

      <Out error={outcome?.error}>{outcome?.text ?? ''}</Out>
    </Step>
  );
}

function HardenedWriteStep({
  settings,
  device,
  handle,
  onHandle,
}: {
  settings: Settings;
  device: EnrolledDevice | null;
  handle: DeviceHandle | null;
  onHandle: (handle: DeviceHandle) => void;
}) {
  const { outcome, busy, run } = useOutcome();
  const [args, setArgs] = useState('{"key": "delegated", "value": "signed-by-an-unexportable-key"}');

  const writeUrl = settings.relayUrl || settings.nodeUrl;

  return (
    <Step
      n={10}
      title="Write a warrant signed by the unexportable key"
      why={
        <>
          The warrant is minted in <code>lib/warrant.ts</code> against the{' '}
          <code>CryptoKey</code>, byte-for-byte to core’s v2 contract — the encoding is
          pinned to <code>warrant_wire_fixture.rs</code>, because a drift here arrives at
          the relay as a 403 nowhere near its cause. The relay still cannot write anything
          you did not sign, and now the key that signed it cannot be stolen from this tab.
        </>
      }
    >
      <dl className="kv">
        <dt>relay</dt>
        <dd>{writeUrl === '' ? <em>none resolved — set a node URL, or run step 3</em> : writeUrl}</dd>
      </dl>

      <label>
        Arguments to <code>set</code> — the exact bytes the warrant commits to
        <textarea value={args} onChange={(e) => setArgs(e.target.value)} />
      </label>

      <div className="row">
        <button
          className="secondary"
          disabled={busy || writeUrl === ''}
          onClick={() =>
            void run(async () => {
              const described = await describeRelay(writeUrl, settings.contextId);
              return described.canAuthorOnBehalf
                ? `this node may author on your behalf.\nexecutor: ${described.executorAccount}`
                : `this node may NOT author on your behalf yet.\nexecutor: ${described.executorAccount}\n\n` +
                    'An admin of that group has to grant it CAN_AUTHOR_ON_BEHALF (bit 9, 512).';
            })
          }
        >
          Check first (signs nothing)
        </button>
        <button
          disabled={busy || !device || writeUrl === ''}
          onClick={() =>
            void run(async () => {
              if (!device) throw new Error('enrol a device in step 7 first');
              const parsed = parseJson(args, 'arguments');
              if (parsed.error !== null) throw new Error(parsed.error);
              const key = handle ?? (await deviceHandle());
              if (!handle) onHandle(key);
              const result = await writeContext(
                writeUrl,
                device,
                key,
                settings.contextId,
                'set',
                parsed.value,
              );
              return `accepted.\nrootHash: ${result.rootHash}\nreturns:  ${pretty(result.returns)}`;
            })
          }
        >
          Sign a warrant and write
        </button>
      </div>

      <Out error={outcome?.error}>{outcome?.text ?? ''}</Out>

      <div className="note">
        <strong>Checking before signing is not politeness.</strong> A warrant consumes a
        number from this device’s monotonic sequence, and one minted against the wrong
        executor is unspendable — the number is gone and the write never happened.
      </div>
    </Step>
  );
}
