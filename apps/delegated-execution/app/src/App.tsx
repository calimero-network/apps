/**
 * Epic calimero-network/core#3928, with buttons.
 *
 *   A client holding only an account root and a device key can: obtain a
 *   session against a node it is not the owner of, read a context it is a
 *   member of, and submit a delegated write — with no password anywhere in the
 *   flow.
 *
 * `apps/scaffolding-e2e/workflows/delegated-session.yml` in calimero-network/core
 * asserts exactly that in CI. This page is the same flow with a person driving
 * it, for the things a scenario cannot show: what the failures look like, how
 * far you get before the missing piece bites, and that the identity in the
 * address bar is one you minted yourself thirty seconds ago.
 *
 * It drives the **scaffolding-e2e contract** rather than shipping its own, so
 * `set`/`get` below are that app's methods and there is no `logic/` directory
 * beside this one. See the README.
 *
 * ## Why the write does not use the session token
 *
 * The clearest thing this page has to teach is that reads and writes are
 * authorised by different things. The session is a bearer token the node minted
 * for a device it authenticated; it permits reads. The write is authorised by a
 * *warrant* — the author's own signature over one context, one method and one
 * exact set of arguments — which the relay spends on their behalf. The relay
 * never gains the ability to write something the author did not sign.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import { Out, Step, type StepState } from './steps/Step.js';
import type { ClassifiedNode } from './lib/admission.js';
import { createIdentity, restoreIdentity, type DeviceIdentity } from './lib/identity.js';
import {
  describeRelay,
  discoverAdmitter,
  openSession,
  readContext,
  writeContext,
} from './lib/flow.js';
import { errorText, parseJson, pretty, short } from './lib/format.js';
import {
  EMPTY_SETTINGS,
  clearStored,
  loadIdentity,
  loadSettings,
  saveIdentity,
  saveSettings,
  type Settings,
} from './lib/storage.js';
import type { DelegatedSession } from '@calimero-network/mero-js';

/** A pending/failed/succeeded result, so every panel reports the same three states. */
interface Outcome {
  text: string;
  error: boolean;
}

function useOutcome() {
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [busy, setBusy] = useState(false);

  /**
   * Run an action, reporting it. Failures are caught rather than thrown:
   * every one of these is an expected outcome of the demo (no membership, no
   * capability, an audience the node does not list) and belongs on the page
   * next to the button, not in the console.
   */
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

  return { outcome, busy, run, reset: () => setOutcome(null) };
}

export function App() {
  const [identity, setIdentity] = useState<DeviceIdentity | null>(null);
  const [phrase, setPhrase] = useState<string | null>(null);
  const [restoreFrom, setRestoreFrom] = useState('');
  const [settings, setSettings] = useState<Settings>(EMPTY_SETTINGS);
  const [session, setSession] = useState<DelegatedSession | null>(null);

  // Loaded in an effect rather than in `useState`'s initialiser because
  // `localStorage` is unavailable during SSR and throws in a private window —
  // and under StrictMode the initialiser runs twice, so a throw there takes the
  // whole page rather than one panel.
  useEffect(() => {
    setIdentity(loadIdentity());
    setSettings(loadSettings());
  }, []);

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      saveSettings(next);
      return next;
    });
  }, []);

  const ready = useMemo(
    () => ({
      identity: identity !== null,
      node: settings.nodeUrl.trim() !== '' && settings.nodeKey.trim().length === 64,
      context: settings.contextId.trim().length === 64,
      session: session !== null,
    }),
    [identity, settings, session],
  );

  return (
    <div className="page">
      <header>
        <h1>Delegated execution, end to end</h1>
        <p className="lede">
          Mint an account in this tab, obtain a session on a node you do not own, read a
          context you are a member of, and write to it through a relay — with no password
          anywhere in the flow.
        </p>
        <p className="lede">
          This is <code>core#3928</code>&rsquo;s criterion with buttons on it. The same
          flow runs headless in CI as <code>delegated-session.yml</code>; this page exists
          so the failures are visible too.
        </p>
      </header>

      <IdentityStep
        identity={identity}
        phrase={phrase}
        restoreFrom={restoreFrom}
        onRestoreFromChange={setRestoreFrom}
        onIdentity={(next, nextPhrase) => {
          saveIdentity(next);
          setIdentity(next);
          setPhrase(nextPhrase);
          // A new identity invalidates the session: the token names the old
          // device. Keeping it would produce a read that succeeds as somebody
          // else, which is the single most misleading thing this page could do.
          setSession(null);
        }}
        onForget={() => {
          clearStored(identity?.devicePublicKey ?? null);
          setIdentity(null);
          setPhrase(null);
          setSession(null);
        }}
      />

      <NodeStep
        settings={settings}
        onChange={updateSettings}
        ready={ready.node}
        identity={identity}
      />

      <SessionStep
        identity={identity}
        settings={settings}
        session={session}
        enabled={ready.identity && ready.node}
        onSession={setSession}
      />

      <ReadStep
        settings={settings}
        session={session}
        enabled={ready.session && ready.context}
      />

      <WriteStep
        identity={identity}
        settings={settings}
        enabled={ready.identity && ready.node && ready.context}
      />

      <footer>
        <p>
          Needs a node running <code>merod 0.11.0-rc.38</code> or newer with the
          <code> account_proof</code> provider enabled, and an admin who has granted that
          node <code>CAN_AUTHOR_ON_BEHALF</code>. Both are in the README beside this file.
        </p>
      </footer>
    </div>
  );
}

function IdentityStep({
  identity,
  phrase,
  restoreFrom,
  onRestoreFromChange,
  onIdentity,
  onForget,
}: {
  identity: DeviceIdentity | null;
  phrase: string | null;
  restoreFrom: string;
  onRestoreFromChange: (value: string) => void;
  onIdentity: (identity: DeviceIdentity, phrase: string) => void;
  onForget: () => void;
}) {
  const { outcome, busy, run } = useOutcome();

  return (
    <Step
      n={1}
      title="Mint an account and a device"
      state={identity ? 'done' : 'idle'}
      stateLabel={identity ? 'held' : 'none yet'}
      why={
        <>
          Two keys, both generated here. The <strong>account root</strong> is the account
          and signs the device&rsquo;s certificate; it is kept in memory only and shown
          once as a phrase. The <strong>device key</strong> signs login statements and
          warrants, and is the only secret this page persists. Neither is ever sent
          anywhere — what travels is the certificate, which carries no secret.
        </>
      }
    >
      {identity ? (
        <dl className="kv">
          <dt>account</dt>
          <dd>{identity.accountId}</dd>
          <dt>device</dt>
          <dd>{short(identity.deviceId, 12)}</dd>
          <dt>device key</dt>
          <dd>{short(identity.devicePublicKey, 12)}</dd>
          <dt>credential</dt>
          <dd>
            {identity.credential.length / 2} bytes — {short(identity.credential, 10)}
          </dd>
        </dl>
      ) : null}

      {phrase ? (
        <>
          <div className="note">
            <strong>Write this down now.</strong> It is the only way back to this account,
            it is not stored anywhere, and it will not be shown again after a reload.
          </div>
          <div className="phrase">{phrase}</div>
        </>
      ) : null}

      <div className="row">
        <button
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const { root, device } = await createIdentity();
              onIdentity(device, root.phrase);
              return `minted account ${short(root.accountId, 10)} and certified its first device`;
            })
          }
        >
          {identity ? 'Mint a different account' : 'Mint an account'}
        </button>
        <button
          className="secondary"
          disabled={busy || restoreFrom.trim() === ''}
          onClick={() =>
            void run(async () => {
              const { root, device } = await restoreIdentity(restoreFrom);
              onIdentity(device, root.phrase);
              return `restored account ${short(root.accountId, 10)} and certified a NEW device for it`;
            })
          }
        >
          Restore from phrase
        </button>
        {identity ? (
          <button className="secondary" disabled={busy} onClick={onForget}>
            Forget this device
          </button>
        ) : null}
      </div>

      <label>
        Recovery phrase — 24 words
        <textarea
          value={restoreFrom}
          placeholder="abandon ability able about above absent …"
          onChange={(e) => onRestoreFromChange(e.target.value)}
        />
      </label>

      <Out error={outcome?.error}>{outcome?.text ?? ''}</Out>
    </Step>
  );
}

function NodeStep({
  settings,
  onChange,
  ready,
  identity,
}: {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  ready: boolean;
  /**
   * Needed to *read* routing, not to join with — the cloud asks a caller to
   * prove which account is asking. So step 2 now depends on step 1, which is
   * the honest ordering: there was never a point in resolving a node before
   * holding the key that will sign the join.
   */
  identity: DeviceIdentity | null;
}) {
  const [classified, setClassified] = useState<ClassifiedNode[]>([]);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [busy, setBusy] = useState(false);

  const discover = useCallback(async () => {
    setBusy(true);
    setOutcome(null);
    try {
      if (!identity) throw new Error('Mint or restore an account in step 1 first.');
      const result = await discoverAdmitter(
        settings.cloudUrl,
        settings.namespaceId,
        settings.invitationJson,
        identity,
      );
      setClassified(result.classified);
      if (result.chosen === null) {
        setOutcome({ text: result.reason ?? 'No node can take a join right now.', error: true });
        return;
      }
      onChange({ nodeUrl: result.chosen.relayUrl ?? '' });
      setOutcome({
        text:
          `Using ${result.chosen.peerId} at ${result.chosen.relayUrl}. ` +
          (result.chosen.canExecute
            ? 'It can also take delegated writes, so one node serves both legs.'
            : 'It can admit but not execute — the write leg will need another node.'),
        error: false,
      });
    } catch (error) {
      setOutcome({ text: error instanceof Error ? error.message : String(error), error: true });
    } finally {
      setBusy(false);
    }
  }, [settings.cloudUrl, settings.namespaceId, settings.invitationJson, identity, onChange]);

  return (
    <Step
      n={2}
      title="Accept an invitation, and let the cloud say where"
      state={ready ? 'done' : 'idle'}
      stateLabel={ready ? 'set' : 'incomplete'}
      why={
        <>
          Two sources, two questions. The invitation&rsquo;s <code>admitters</code> list sits{' '}
          <em>inside</em> the body the group admin signed, so it says who is <em>allowed</em> to
          admit you — a node outside it refuses the claim whatever else is true. The cloud says who
          is <em>reachable</em>: a URL, a fresh heartbeat, and whether the node holds{' '}
          <code>CAN_AUTHOR_ON_BEHALF</code>. Neither answers both, so the node is the intersection.
          A node that is live and healthy but absent from your signed list will still answer with
          403 — the signed list is a snapshot from when the invitation was minted, and says nothing
          about nodes assigned since.
        </>
      }
    >
      <label>
        Cloud URL
        <input
          type="text"
          value={settings.cloudUrl}
          placeholder="https://manager.cloud.calimero.network"
          onChange={(e) => onChange({ cloudUrl: e.target.value.trim() })}
        />
      </label>
      <label>
        Namespace id — 64 hex
        <input
          type="text"
          value={settings.namespaceId}
          placeholder="89ab…"
          onChange={(e) => onChange({ namespaceId: e.target.value.trim() })}
        />
      </label>
      <label>
        Invitation — paste it exactly as the operator&rsquo;s node issued it
        <textarea
          rows={4}
          value={settings.invitationJson}
          placeholder={'{"invitation": {"admitters": ["…"]}, "inviter_signature": "…"}'}
          onChange={(e) => onChange({ invitationJson: e.target.value })}
        />
      </label>
      <label>
        Context id — 64 hex
        <input
          type="text"
          value={settings.contextId}
          placeholder="89ab…"
          onChange={(e) => onChange({ contextId: e.target.value.trim() })}
        />
      </label>
      <label>
        Node signing key — 64 hex, still pinned out of band
        <input
          type="text"
          value={settings.nodeKey}
          placeholder="0123…"
          onChange={(e) => onChange({ nodeKey: e.target.value.trim() })}
        />
      </label>
      <p className="aside">
        The one field discovery cannot supply. Your device signs a login statement naming this key,
        and that binding is what stops a statement signed for one node being replayed to another —
        so a node that told you its own key could decide what you signed about. The invitation does
        not carry it and neither does the cloud, and a cloud serving a node-<em>reported</em> value
        would move the trust-on-first-use one hop rather than remove it. Removing this field means
        binding the key into the attestation quote, which is tracked separately.
      </p>

      <button type="button" onClick={discover} disabled={busy || !identity}>
        {busy ? 'Asking the cloud…' : 'Find a node that can admit me'}
      </button>
      {!identity && (
        <p className="aside">
          Disabled until step 1 holds a key. The cloud asks this read to name an account, and
          the proof is a challenge signed by your certified device key — so there is nothing to
          sign with yet. It proves you hold <em>an</em> account, not that you were invited to this
          namespace: the cloud cannot know that, because membership lives on the nodes. What it
          buys is that a routing read is attributable rather than anonymous.
        </p>
      )}

      {classified.length > 0 && (
        <ul className="nodes">
          {classified.map(({ node, admissibility }) => (
            <li key={node.peerId} data-kind={admissibility.kind}>
              <code>{node.peerId}</code> — {node.relayUrl ?? 'no URL yet'}
              {admissibility.kind === 'usable' && ' · invited and reachable'}
              {admissibility.kind === 'invited-unreachable' &&
                ' · invited, but no fresh heartbeat — wait rather than re-invite'}
              {admissibility.kind === 'not-invited' &&
                ' · healthy, but your invitation does not name it — a claim here is refused'}
            </li>
          ))}
        </ul>
      )}

      <Out error={outcome?.error}>{outcome?.text ?? ''}</Out>
    </Step>
  );
}

function SessionStep({
  identity,
  settings,
  session,
  enabled,
  onSession,
}: {
  identity: DeviceIdentity | null;
  settings: Settings;
  session: DelegatedSession | null;
  enabled: boolean;
  onSession: (session: DelegatedSession | null) => void;
}) {
  const { outcome, busy, run } = useOutcome();

  return (
    <Step
      n={3}
      title="Obtain a session — no password"
      state={session ? 'done' : 'idle'}
      stateLabel={session ? 'open' : 'closed'}
      why={
        <>
          The node issues a challenge; the device key signs a statement naming this
          origin, that challenge and a freshly minted session key; the node returns a
          token. The device key never leaves the tab, and the token authorises reads
          only — <code>context:query</code> and <code>context:intent</code>, which is
          deliberately the whole delegated surface and nothing above it.
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
          disabled={!enabled || busy || !identity}
          onClick={() =>
            void run(async () => {
              if (!identity) throw new Error('no device identity');
              const opened = await openSession(settings.nodeUrl, settings.nodeKey, identity);
              onSession(opened);
              return 'session minted from a signed statement — no password was sent';
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
          A 401 here is usually one of three things, and the node cannot tell you which:
          the <strong>audience</strong> (<code>{window.location.origin}</code>) is not in
          the node&rsquo;s <code>allowed_audiences</code>, the{' '}
          <strong>node key</strong> above is not the one the node signs with, or the
          provider is not enabled at all. The README says how to check each.
        </div>
      ) : null}
    </Step>
  );
}

function ReadStep({
  settings,
  session,
  enabled,
}: {
  settings: Settings;
  session: DelegatedSession | null;
  enabled: boolean;
}) {
  const { outcome, busy, run } = useOutcome();
  const [key, setKey] = useState('delegated');

  return (
    <Step
      n={4}
      title="Read the context"
      why={
        <>
          <code>POST /admin-api/contexts/&lt;id&gt;/query</code> with the session token.
          The node re-checks membership on <em>every</em> call rather than trusting the
          session, so a member removed mid-session stops being able to read immediately.
          Only <code>&amp;self</code> methods are reachable here — a mutating method is
          refused rather than run, which is what makes a read-only token meaningful.
        </>
      }
    >
      <label>
        Key to read — <code>get(key)</code> on the scaffolding-e2e contract
        <input type="text" value={key} onChange={(e) => setKey(e.target.value)} />
      </label>

      <div className="row">
        <button
          disabled={!enabled || busy}
          onClick={() =>
            void run(async () => {
              if (!session) throw new Error('no session');
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

function WriteStep({
  identity,
  settings,
  enabled,
}: {
  identity: DeviceIdentity | null;
  settings: Settings;
  enabled: boolean;
}) {
  const { outcome, busy, run } = useOutcome();
  const [args, setArgs] = useState('{"key": "delegated", "value": "written-from-a-browser"}');

  return (
    <Step
      n={5}
      title="Write through the relay"
      why={
        <>
          The session plays no part here. Your device signs a <strong>warrant</strong> —
          one context, one method, these exact argument bytes, one nonce, an expiry — and
          the node runs it as <em>you</em>. The resulting delta carries your account and
          device, not the node&rsquo;s. Spending the same warrant twice is refused,
          because the nonce is consumed by the network on apply.
        </>
      }
    >
      <label>
        Arguments to <code>set</code> — the exact bytes the warrant will commit to
        <textarea value={args} onChange={(e) => setArgs(e.target.value)} />
      </label>

      <div className="row">
        <button
          className="secondary"
          disabled={!enabled || busy}
          onClick={() =>
            void run(async () => {
              const described = await describeRelay(settings.nodeUrl, settings.contextId);
              return described.canAuthorOnBehalf
                ? `this node may author on your behalf.\nexecutor: ${described.executorAccount}\ngroup:    ${described.groupId}`
                : `this node may NOT author on your behalf yet.\nexecutor: ${described.executorAccount}\ngroup:    ${described.groupId}\n\n` +
                    'An admin of that group has to grant it CAN_AUTHOR_ON_BEHALF (bit 9, 512) —\n' +
                    'meroctl group members set-capabilities, or the default mask at namespace creation.';
            })
          }
        >
          Check first (signs nothing)
        </button>
        <button
          disabled={!enabled || busy}
          onClick={() =>
            void run(async () => {
              if (!identity) throw new Error('no device identity');
              const parsed = parseJson(args, 'arguments');
              if (parsed.error !== null) throw new Error(parsed.error);
              const result = await writeContext(
                settings.nodeUrl,
                identity,
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
        number from this device&rsquo;s monotonic sequence, and one minted against the
        wrong executor is unspendable — the number is gone and the write never happened.
        That is why the check button exists and why it signs nothing.
      </div>
    </Step>
  );
}

export type { StepState };
