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
 *
 * ## Why the panels are in this order
 *
 * They used to be in protocol order, which put the two *optional* things early
 * (connecting to a cloud login was step 2 of 6) and collapsed four unrelated
 * values into one panel of four identical text boxes. The order now follows
 * what a person actually has to establish, and each value sits beside the
 * question it answers:
 *
 * - **1 Identity** — the keys, minted here.
 * - **2 Reach** — where to send things. Two ways in, and they are genuinely
 *   different: a *returning* device asks the cloud which relays already hold
 *   something for its account and needs no invitation at all; a *first* join
 *   has no such record and needs the invitation, which is also where the
 *   namespace id comes from. The old page only modelled the second and made
 *   everyone type a namespace id that was already in the blob beside it.
 * - **3 Pin** — the node's signing key, alone, because it is the only value on
 *   the page that must not be told to you.
 * - **4–6 Session, read, write** — the flow itself.
 * - **7 Cloud** — last and marked optional, because nothing above it depends on
 *   a cloud login and the README had to spend a paragraph saying so.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import { Out, Provenance, Step, type StepState } from './steps/Step.js';
import { Strip, type Slot } from './steps/Strip.js';
import type { ClassifiedNode } from './lib/admission.js';
import { createIdentity, restoreIdentity, type DeviceIdentity } from './lib/identity.js';
import type { AccountClaimResult, AccountProofResult } from './lib/flow.js';
import {
  claimAccountWithCloud,
  cloudNamespacesForSession,
  finishCloudLink,
  startCloudLink,
  describeRelay,
  discoverAdmitter,
  findAccountRelays,
  proveAccountToCloud,
  readInvitation,
  sendJoin,
  openSession,
  readContext,
  writeContext,
} from './lib/flow.js';
import { errorText, hostOf, parseJson, pretty, short } from './lib/format.js';
import { CloudClient, type CloudAccountRelay } from '@calimero-network/mero-js';
import {
  DEFAULT_CLOUD_URL,
  DEFAULT_PORTAL_URL,
  DEFAULT_SETTINGS,
  clearPendingLink,
  clearStored,
  loadClaim,
  loadPendingLink,
  savePendingLink,
  loadIdentity,
  loadSettings,
  saveClaim,
  saveIdentity,
  saveSettings,
  type AccountClaim,
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
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [session, setSession] = useState<DelegatedSession | null>(null);
  const [claim, setClaim] = useState<AccountClaim | null>(null);

  // Loaded in an effect rather than in `useState`'s initialiser because
  // `localStorage` is unavailable during SSR and throws in a private window —
  // and under StrictMode the initialiser runs twice, so a throw there takes the
  // whole page rather than one panel.
  useEffect(() => {
    setIdentity(loadIdentity());
    setSettings(loadSettings());
    setClaim(loadClaim());
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
      reach: settings.nodeUrl.trim() !== '',
      pinned: settings.nodeKey.trim().length === 64,
      node: settings.nodeUrl.trim() !== '' && settings.nodeKey.trim().length === 64,
      context: settings.contextId.trim().length === 64,
      session: session !== null,
    }),
    [identity, settings, session],
  );

  /**
   * The strip's slots, in the order the flow needs them.
   *
   * `warn` rather than `none` wherever the value is *expected* to be absent for
   * a while: a node key nobody has pinned yet is the normal state on first
   * load, and colouring it like a failure would train people to ignore it.
   */
  const slots: readonly Slot[] = useMemo(
    () => [
      {
        label: 'account',
        value: identity ? short(identity.accountId, 6) : 'none',
        state: identity ? 'ok' : 'none',
        title: identity ? identity.accountId : 'Mint or restore one in step 1.',
      },
      {
        label: 'device',
        value: identity ? short(identity.deviceId, 6) : 'none',
        state: identity ? 'ok' : 'none',
        title: identity ? identity.deviceId : 'Certified by the account root in step 1.',
      },
      {
        label: 'relay',
        value: settings.nodeUrl === '' ? 'none' : hostOf(settings.nodeUrl),
        state: ready.reach ? 'ok' : 'none',
        title:
          settings.nodeUrl === ''
            ? 'Step 2 finds one — from your account’s relays, or from an invitation.'
            : settings.nodeUrl,
      },
      {
        label: 'node key',
        value: ready.pinned ? short(settings.nodeKey, 5) : 'unpinned',
        state: ready.pinned ? 'ok' : 'warn',
        title: ready.pinned
          ? settings.nodeKey
          : 'Step 3. The one value on this page nothing may tell you — the session binds to it.',
      },
      {
        label: 'session',
        value: session ? 'open' : 'closed',
        state: session ? 'ok' : 'none',
        title: session ? 'Reads only: context:query, context:intent, context:subscribe.' : 'Step 4.',
      },
      {
        label: 'cloud',
        value: claim === null ? 'not connected' : claim.linked ? 'linked' : 'proven',
        state: claim === null ? 'none' : claim.linked ? 'ok' : 'warn',
        title:
          claim === null
            ? 'Optional — step 7. Nothing above it needs a cloud login.'
            : claim.linked
              ? `Linked to ${claim.email}`
              : 'Ownership recorded, but this account is not linked to a cloud login.',
      },
    ],
    [identity, settings.nodeUrl, settings.nodeKey, ready.reach, ready.pinned, session, claim],
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

      <Strip slots={slots} />

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
          // The claim names the OLD account. Keeping it would leave the page
          // reporting a connected cloud for an account this tab can no longer
          // prove anything about.
          setClaim(null);
        }}
        onForget={() => {
          clearStored(identity?.devicePublicKey ?? null);
          setIdentity(null);
          setPhrase(null);
          setSession(null);
          setClaim(null);
        }}
      />

      <ReachStep settings={settings} onChange={updateSettings} identity={identity} />

      <PinStep settings={settings} onChange={updateSettings} />

      <SessionStep
        identity={identity}
        settings={settings}
        session={session}
        enabled={ready.identity && ready.node}
        onSession={setSession}
      />

      <ReadStep
        settings={settings}
        onChange={updateSettings}
        session={session}
        enabled={ready.session && ready.context}
      />

      <WriteStep
        identity={identity}
        settings={settings}
        enabled={ready.identity && ready.node && ready.context}
      />

      <AccountCloudStep
        identity={identity}
        settings={settings}
        onChange={updateSettings}
        claim={claim}
        onClaim={(next) => {
          saveClaim(next);
          setClaim(next);
        }}
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

/**
 * Where to send things — the panel the redesign is actually about.
 *
 * ## Two ways in, and they are not the same way
 *
 * A **returning** device holds a key the network already knows: it has joined
 * something, a relay serving that namespace wrote a recovery record for it, and
 * the cloud can therefore answer *which relays hold something for this account*
 * from the distinct writers of those records. No invitation is involved, and
 * none would help — an invitation is a one-shot thing you are given before you
 * are a member, and this device already is one.
 *
 * A **first** join has no such record, by construction. The account has never
 * been admitted anywhere, so nothing has ever written for it and the lookup
 * correctly returns nothing. What it has instead is the invitation, which
 * carries both the namespace and the accounts allowed to admit a claim of it.
 *
 * The old page modelled only the second and put the first through it, so a
 * returning device had to find an invitation it no longer needed. Discovery is
 * the default here and the invitation is the fallback, which is the order they
 * happen in.
 *
 * ## What the relay lookup deliberately does not return
 *
 * Namespaces. The cloud derives the answer from *who wrote* the recovery
 * records, never from what they contain, so the response names relays and
 * nothing else — strictly less than the edge itself discloses. That is also why
 * the namespace id below comes from the invitation rather than from this
 * lookup: for a returning device with no invitation to hand, the authoritative
 * answer lives at the node, which is a gap this page reports rather than papers
 * over.
 */
function ReachStep({
  settings,
  onChange,
  identity,
}: {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  identity: DeviceIdentity | null;
}) {
  const [classified, setClassified] = useState<ClassifiedNode[]>([]);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [busy, setBusy] = useState(false);
  const [joined, setJoined] = useState(false);
  const [proof, setProof] = useState<AccountProofResult | null>(null);
  const [known, setKnown] = useState<{
    usable: CloudAccountRelay[];
    others: CloudAccountRelay[];
  } | null>(null);

  /**
   * The namespace, read out of the pasted invitation rather than typed.
   *
   * Recomputed on every keystroke rather than stored, so the panel cannot show
   * a namespace belonging to an invitation that has since been replaced. A
   * parse failure is not reported here — an empty box is the normal state and
   * an error under it while someone is still pasting is noise. The buttons
   * report it, because that is where acting on a bad invitation happens.
   */
  const invited = useMemo(() => {
    if (settings.invitationJson.trim() === '') return null;
    try {
      return readInvitation(settings.invitationJson);
    } catch {
      return null;
    }
  }, [settings.invitationJson]);

  const lookUp = useCallback(async () => {
    setBusy(true);
    setOutcome(null);
    try {
      if (!identity) throw new Error('Mint or restore an account in step 1 first.');
      if (settings.cloudUrl.trim() === '') throw new Error('Enter your cloud API URL first.');
      const found = await findAccountRelays(settings.cloudUrl, identity);
      setKnown(found);
      setOutcome({
        text:
          found.usable.length > 0
            ? `${found.usable.length} relay(s) already hold something for this account. Pick ` +
              'one — no invitation is needed, because you are already a member of whatever ' +
              'they serve.'
            : found.others.length > 0
              ? `The cloud knows ${found.others.length} relay(s) for this account, but none is ` +
                'usable right now — no address, or no fresh heartbeat. That is "your relay is ' +
                'down", not "you have no relay": wait rather than re-join.'
              : 'No relay holds anything for this account yet. That is the normal answer for a ' +
                'key that has never joined anything — use the invitation below.',
        error: false,
      });
    } catch (error) {
      setKnown(null);
      setOutcome({ text: errorText(error), error: true });
    } finally {
      setBusy(false);
    }
  }, [identity, settings.cloudUrl]);

  /**
   * Point both legs at one relay.
   *
   * `relayUrl` too, not just `nodeUrl`: this lookup cannot say whether a relay
   * holds `CAN_AUTHOR_ON_BEHALF`, and refusing to set the write leg would leave
   * the page unable to attempt the thing it exists to demonstrate. The write
   * panel's "Check first" answers the capability question without signing, so
   * the honest wiring is to point at it and let that button say no.
   */
  const pick = useCallback(
    (relay: CloudAccountRelay) => {
      if (!relay.relayUrl) return;
      onChange({ nodeUrl: relay.relayUrl, relayUrl: relay.relayUrl, admitUrl: '' });
      setOutcome({
        text:
          `Pointed at ${relay.relayUrl}. This lookup cannot tell you whether that node may ` +
          'author on your behalf — the cloud is not asked, because it does not decide. Step 6’s ' +
          '“Check first” answers it without spending a warrant nonce.',
        error: false,
      });
    },
    [onChange],
  );

  /**
   * The namespace a routing proof is bound to.
   *
   * A pasted invitation wins, because it is what the person is currently
   * working on. Failing that, the last namespace this tab actually joined —
   * which is why `settings.namespaceId` is written by the two actions below and
   * kept: after a successful join the invitation has done its job and gets
   * cleared or replaced, and a returning device would otherwise have nothing to
   * bind a proof to.
   */
  const provableNamespace = invited?.namespaceId ?? (settings.namespaceId || null);

  const prove = useCallback(async () => {
    setBusy(true);
    setOutcome(null);
    try {
      if (!identity) throw new Error('Mint or restore an account in step 1 first.');
      if (!provableNamespace) {
        throw new Error(
          'This proof is bound to one namespace, and there is none to hand: paste an invitation, ' +
            'or join one first.',
        );
      }
      const result = await proveAccountToCloud(settings.cloudUrl, provableNamespace, identity);
      setProof(result);
      setOutcome({
        text:
          `The cloud served this read as ${short(result.accountId, 10)} rather than anonymously, ` +
          `and answered with ${result.nodeCount} node(s).`,
        error: false,
      });
    } catch (error) {
      setProof(null);
      setOutcome({ text: errorText(error), error: true });
    } finally {
      setBusy(false);
    }
  }, [identity, settings.cloudUrl, provableNamespace]);

  const discover = useCallback(async () => {
    setBusy(true);
    setOutcome(null);
    try {
      if (!identity) throw new Error('Mint or restore an account in step 1 first.');
      const result = await discoverAdmitter(
        settings.cloudUrl,
        settings.invitationJson,
        identity,
      );
      setClassified(result.classified);
      if (result.chosen === null) {
        setOutcome({ text: result.reason ?? 'No node can take a join right now.', error: true });
        return;
      }
      // Two fields, because they answer two questions. The write leg used to
      // reuse `nodeUrl` even when the panel had just said this node cannot
      // execute — it told you the problem and then walked into it.
      const relayUrl = result.executor?.relayUrl ?? '';
      onChange({
        namespaceId: result.namespaceId,
        nodeUrl: result.chosen.relayUrl ?? '',
        relayUrl,
        admitUrl: result.chosen.admitUrl ?? '',
      });

      const admitLine = `Admitting through ${result.chosen.peerId} at ${result.chosen.relayUrl}.`;
      const writeLine =
        result.executor === null
          ? ` No relay for the write: ${result.executorReason ?? 'none available.'}`
          : result.executor.peerId === result.chosen.peerId
            ? ' It also holds the authorship grant, so one node serves both legs.'
            : ` Writing through ${result.executor.peerId} at ${result.executor.relayUrl}` +
              ' — a different node, because admission and authorship are different grants.';
      setOutcome({ text: admitLine + writeLine, error: false });
    } catch (error) {
      setOutcome({ text: errorText(error), error: true });
    } finally {
      setBusy(false);
    }
  }, [settings.cloudUrl, settings.invitationJson, identity, onChange]);

  const join = useCallback(async () => {
    setBusy(true);
    setOutcome(null);
    try {
      if (!identity) throw new Error('Mint or restore an account in step 1 first.');
      if (settings.admitUrl === '') throw new Error('Find an admitter first — the button above.');
      const { published, namespaceId } = await sendJoin(
        settings.admitUrl,
        identity,
        settings.invitationJson,
      );
      onChange({ namespaceId });
      setJoined(published);
      setOutcome({
        // `published` is the honest word the endpoint uses, and the distinction
        // is real: the admitter put the op on the namespace topic and neither
        // applies it nor waits for anyone who does. Membership lands when peers
        // fold it, which is why the read is what confirms this worked.
        text: published
          ? 'Signed and published. The admitter carried it; membership lands when peers fold ' +
            'the op, so step 5 is what confirms it — a 403 straight after is usually a race, ' +
            'not a refusal.'
          : 'The admitter accepted the call but reported nothing published. Treat that as not ' +
            'joined and try another admitter.',
        error: !published,
      });
    } catch (error) {
      setOutcome({ text: errorText(error), error: true });
    } finally {
      setBusy(false);
    }
  }, [identity, settings.admitUrl, settings.invitationJson, onChange]);

  const reached = settings.nodeUrl !== '';

  return (
    <Step
      n={2}
      title="Find where you can go"
      state={reached ? 'done' : 'idle'}
      stateLabel={reached ? hostOf(settings.nodeUrl) : 'nowhere yet'}
      why={
        <>
          Two ways in, and which one applies is decided by whether this account has ever
          joined anything. A <strong>returning</strong> device asks the cloud which relays
          already hold something for it — no invitation, because it is already a member. A{' '}
          <strong>first</strong> join has no such record and uses the invitation, whose
          signed body carries both the namespace and the accounts allowed to admit a claim
          of it. The cloud says who is <em>reachable</em>; only the invitation says who is{' '}
          <em>allowed</em>, so a live, healthy node absent from that signed list still
          answers 403.
        </>
      }
    >
      <label>
        Cloud API URL
        <input
          type="text"
          value={settings.cloudUrl}
          placeholder={DEFAULT_CLOUD_URL}
          onChange={(e) => onChange({ cloudUrl: e.target.value.trim() })}
        />
      </label>

      <Provenance
        kind="found"
        title="Relays that already hold something for this account"
        note={
          <>
            Proven with the device certificate rather than a cloud login, so a tab holding only
            a key can ask. The cloud derives this from <em>who wrote</em> your recovery records
            — a relay writes only for namespaces it serves — so the answer names relays and
            never namespaces, which is strictly less than the fact of the record already
            discloses.
          </>
        }
      >
        <div className="row">
          <button type="button" onClick={() => void lookUp()} disabled={busy || !identity}>
            {busy ? 'Asking the cloud…' : 'Find my relays'}
          </button>
        </div>

        {known !== null && (
          <ul className="nodes">
            {known.usable.map((relay) => (
              <li key={relay.peerId} data-kind="usable">
                <code>{relay.peerId}</code> — {relay.relayUrl}
                {' · '}
                <button type="button" className="link" onClick={() => pick(relay)}>
                  {settings.nodeUrl === relay.relayUrl ? 'in use' : 'use this one'}
                </button>
              </li>
            ))}
            {known.others.map((relay) => (
              <li key={relay.peerId} data-kind="invited-unreachable">
                <code>{relay.peerId}</code> —{' '}
                {relay.relayUrl
                  ? 'known, but no fresh heartbeat — wait rather than re-join'
                  : 'known, but the cloud has no address for it yet'}
              </li>
            ))}
            {known.usable.length === 0 && known.others.length === 0 && (
              <li>
                none — the normal answer for a key that has never joined anything, and the
                reason the invitation below exists
              </li>
            )}
          </ul>
        )}
      </Provenance>

      <Provenance
        kind="given"
        title="An invitation, for a first join"
        note={
          <>
            Needed once and never again: it is what makes the account a member, and a returning
            device uses the lookup above instead. The <strong>namespace id is inside it</strong>,
            so there is no field for one — a typed id that disagreed with the signed one produced
            a join for a namespace the invitation does not cover, refused with a 403 that reads
            like a permissions problem.
          </>
        }
      >
        <label>
          Invitation — paste it exactly as the operator&rsquo;s node issued it
          <textarea
            rows={4}
            value={settings.invitationJson}
            placeholder={'{"invitation": {"group_id": "…", "admitters": ["…"]}, "inviter_signature": "…"}'}
            onChange={(e) => onChange({ invitationJson: e.target.value })}
          />
        </label>

        {!invited && settings.namespaceId !== '' && (
          <p className="aside">
            Last joined <code>{short(settings.namespaceId, 10)}</code>. Kept after the invitation
            is cleared, because a returning device has nothing else to name a namespace with —
            the node knows, but an <code>account_proof</code> session is not given{' '}
            <code>namespace:list</code>.
          </p>
        )}

        {invited && (
          <dl className="kv">
            <dt>namespace</dt>
            <dd>
              {invited.namespaceId} <span className="derived">read from the signed body</span>
            </dd>
            <dt>admitters</dt>
            <dd>
              {invited.admitters.length === 0
                ? 'none named — the legacy path, where any ready peer may admit you'
                : invited.admitters.map((a) => short(a, 8)).join(', ')}
            </dd>
          </dl>
        )}

        <div className="row">
          <button type="button" onClick={() => void discover()} disabled={busy || !identity || !invited}>
            {busy ? 'Asking the cloud…' : 'Find a node that can admit me'}
          </button>
          <button
            type="button"
            onClick={() => void join()}
            disabled={busy || !identity || settings.admitUrl === ''}
          >
            {busy ? 'Signing and sending…' : joined ? 'Join sent — send again' : 'Sign and send my join'}
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => void prove()}
            disabled={busy || !identity || !provableNamespace}
          >
            {busy ? 'Proving…' : 'Show me the proof this read makes'}
          </button>
        </div>
        <p className="aside">
          The second button is the one that makes you a <strong>member</strong>. Your device signs
          the membership op and the admitter only carries it — every peer checks the signer against
          the certificate in the op, so the node relaying it cannot admit a different account,
          change the group or grant itself a role. It can refuse, and that is the whole of its
          power. Until this succeeds the read answers 403 and the write is refused, because there
          is nothing to be a member of yet.
        </p>

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
      </Provenance>

      {proof !== null && (
        <>
          <dl className="kv">
            <dt>challenge</dt>
            <dd>
              {short(proof.nonce, 12)} — expires{' '}
              {new Date(proof.expiresAtMs).toLocaleTimeString()}
            </dd>
            <dt>signed by</dt>
            <dd>the device key, {short(proof.signature, 12)}</dd>
            <dt>read as</dt>
            <dd>{proof.accountId}</dd>
          </dl>
          <p className="aside">
            Every lookup on this panel already makes this proof; the button only shows it. The
            cloud minted a sealed challenge, your <strong>device</strong> key signed it, and the
            read went through naming that account. The certificate alone would prove nothing — it
            travels in the clear inside every device-link op — so only this signature binds you to
            the device. Nothing was stored and no session was issued: a challenge expires in about
            two minutes and every read proves itself again. What it buys is{' '}
            <em>attribution</em>, not authorization. It does <strong>not</strong> prove you were
            invited or are a member; the cloud cannot know either, and that check lives at the
            node, on the signed op.
          </p>
        </>
      )}

      {!identity && (
        <p className="aside">
          Disabled until step 1 holds a key. Both paths here ask the cloud to serve a read as an
          account, and the proof is a challenge signed by your certified device key — so there is
          nothing to sign with yet.
        </p>
      )}

      <Out error={outcome?.error}>{outcome?.text ?? ''}</Out>
    </Step>
  );
}

/**
 * The node's signing key, alone in its own panel.
 *
 * It used to be the fourth of four text boxes and looked exactly like the three
 * beside it, which was the worst thing about the old layout: the other three
 * are values somebody hands you and this one is a value that must *not* be
 * handed to you. A panel of its own is the cheapest way to say that.
 */
function PinStep({
  settings,
  onChange,
}: {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
}) {
  const pinned = settings.nodeKey.trim().length === 64;

  return (
    <Step
      n={3}
      title="Pin the node’s signing key"
      state={pinned ? 'done' : 'idle'}
      stateLabel={pinned ? 'pinned' : 'not pinned'}
      why={
        <>
          The one value on this page that nothing may tell you. Your device signs a login
          statement naming this key, and that binding is what stops a statement signed for one
          node being replayed to another — so a node that told you its own key would be choosing
          what you signed about. Neither the invitation nor the cloud carries it, and a cloud
          serving a node-<em>reported</em> value would move the trust-on-first-use one hop rather
          than remove it.
        </>
      }
    >
      <Provenance
        kind="pinned"
        title="Established out of band, by you"
        note={
          <>
            From the operator, over a channel you already trust, or read from the node yourself
            with <code>curl -s &lt;node&gt;/admin-api/identity</code>. Removing this field means
            binding the key into the attestation quote, which is tracked separately.
          </>
        }
      >
        <label>
          Node signing key — 64 hex
          <input
            type="text"
            value={settings.nodeKey}
            placeholder="0123…"
            onChange={(e) => onChange({ nodeKey: e.target.value.trim() })}
          />
        </label>
      </Provenance>

      {settings.nodeKey.trim() !== '' && !pinned && (
        <div className="note">
          That is {settings.nodeKey.trim().length} characters, and a signing key is 64 hex. A
          statement signed against the wrong key is refused with the same 401 as a disabled
          provider, so the length is worth catching here.
        </div>
      )}
    </Step>
  );
}

/**
 * Claim this account with a cloud — the one proof on the page the root makes.
 *
 * Kept as its own step rather than folded into the routing panel because it is
 * a different kind of thing in three ways: it is signed by the ROOT and not the
 * device, it is done ONCE rather than on every read, and the cloud REMEMBERS
 * it. The routing proof beside it is re-made on every lookup and leaves nothing
 * behind. Two panels both saying "prove" would be confusing; one panel doing
 * both would hide exactly the distinction worth showing.
 */
function AccountCloudStep({
  identity,
  settings,
  onChange,
  claim,
  onClaim,
}: {
  identity: DeviceIdentity | null;
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  claim: AccountClaim | null;
  onClaim: (claim: AccountClaim) => void;
}) {
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AccountClaimResult | null>(null);
  const [namespaces, setNamespaces] = useState<string[] | null>(null);
  const [linked, setLinked] = useState(false);

  // An identity minted before this version of the page never stored a root, so
  // the claim is offered only when there is actually a key here to sign it.
  const rootSecret = identity?.rootSecret ?? '';
  const claimed = claim !== null && claim.accountId === identity?.accountId;

  // The cloud's answer arrives as a fresh page load, so this runs once on mount
  // and is the only thing that knows a round trip was in progress. Both halves
  // clear the pending record: leaving one behind would make the next ordinary
  // reload look like a callback.
  useEffect(() => {
    const callback = CloudClient.readAccountLinkCallback();
    if (!callback.grant && !callback.error) return;
    // Strip the fragment first, so a reload after this does not replay it.
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
    const pending = loadPendingLink();
    // Read the identity from storage rather than from `identity` above. This
    // effect has `[]` deps, so its closure holds the FIRST render's value --
    // and `identity` is null then, because it is loaded in the effect above
    // and `setIdentity` does not apply until the next render. Reading the
    // state variable here made `!identity` always true, so every returning
    // grant was rejected as "this tab no longer knows what it was for" and the
    // link could never complete. `pending` was already read this way.
    const linkIdentity = loadIdentity();
    clearPendingLink();

    if (callback.error) {
      setOutcome({
        text:
          callback.error === 'denied'
            ? 'You cancelled at the cloud, so nothing was linked. The account is unchanged.'
            : `The cloud sent back an error: ${callback.error}`,
        error: callback.error !== 'denied',
      });
      return;
    }
    // Two different failures; say which, because the fixes differ. A missing
    // pending record means this browser did not start the round trip (or
    // already answered it); a missing identity means the key it was for is
    // gone, and starting again would only reach the same place.
    if (!pending || !linkIdentity) {
      setOutcome({
        text: !linkIdentity
          ? 'A grant came back but this browser holds no account key to sign it with. Create or restore an identity, then connect again.'
          : 'A grant came back but this tab no longer knows what it was for. Start the connection again.',
        error: true,
      });
      return;
    }

    setBusy(true);
    finishCloudLink(pending, callback.grant as string, linkIdentity)
      .then((link) => {
        setLinked(true);
        setOutcome({
          text: link.alreadyLinked
            ? `That account was already linked to this cloud login. Prove it now and you will get a session.`
            : `Linked ${short(link.accountId, 10)} to your cloud login. Prove it now to open a session as it.`,
          error: false,
        });
      })
      .catch((error) => setOutcome({ text: errorText(error), error: true }))
      .finally(() => setBusy(false));
    // Mount only: a callback is answered once. Nothing here reads component
    // state, so the dep list is honestly empty and needs no suppression --
    // the previous `exhaustive-deps` disable is what hid the stale `identity`
    // read that broke this path.
  }, []);

  const connectCloud = useCallback(() => {
    setOutcome(null);
    try {
      if (!identity) throw new Error('Mint or restore an account in step 1 first.');
      if (settings.portalUrl.trim() === '') throw new Error('Enter the cloud portal URL first.');
      if (settings.cloudUrl.trim() === '') throw new Error('Enter your cloud API URL first.');
      savePendingLink(startCloudLink(settings.cloudUrl, settings.portalUrl, identity));
      setOutcome({
        text:
          'Opened the cloud in a new tab. Sign in there, check the account it names, and press ' +
          'Connect — you will be sent back here with a grant this tab then signs.',
        error: false,
      });
    } catch (error) {
      setOutcome({ text: errorText(error), error: true });
    }
  }, [identity, settings.cloudUrl, settings.portalUrl]);

  const connect = useCallback(async () => {
    setBusy(true);
    setOutcome(null);
    setNamespaces(null);
    try {
      if (!identity) throw new Error('Mint or restore an account in step 1 first.');
      if (rootSecret === '') {
        throw new Error(
          'This identity was minted before the page kept the account root, so there is no key ' +
            'here to sign the claim with. Restore from your phrase, or mint a new account.',
        );
      }
      if (settings.cloudUrl.trim() === '') throw new Error('Enter your cloud URL first.');

      const claimResult = await claimAccountWithCloud(settings.cloudUrl, rootSecret);
      setResult(claimResult);
      onClaim({
        accountId: claimResult.accountId,
        cloudUrl: settings.cloudUrl,
        provenAt: Date.now(),
        linked: claimResult.linked,
        sessionToken: claimResult.sessionToken,
        email: claimResult.email,
      });
      setOutcome({
        text: claimResult.linked
          ? `The cloud recorded ${short(claimResult.accountId, 10)} as owned by the key that ` +
            `signed, and opened a session as ${claimResult.email}. Nothing but the root proved it.`
          : `Ownership of ${short(claimResult.accountId, 10)} is recorded. No session: this ` +
            'account is not linked to a cloud login, so there is no plan or namespace list to ' +
            'open one over. Link it once from a signed-in cloud session and come back — the ' +
            'proof stands.',
        error: false,
      });
    } catch (error) {
      setResult(null);
      setOutcome({ text: errorText(error), error: true });
    } finally {
      setBusy(false);
    }
  }, [identity, rootSecret, settings.cloudUrl, onClaim]);

  const fetchNamespaces = useCallback(async () => {
    setBusy(true);
    setOutcome(null);
    try {
      if (!claim || claim.sessionToken === '') {
        throw new Error('No account session held — claim the account first.');
      }
      const rows = await cloudNamespacesForSession(claim.cloudUrl, claim.sessionToken);
      setNamespaces(rows);
      setOutcome({
        text:
          `The cloud answered a signed-in read with ${rows.length} namespace(s), for a session ` +
          'this tab obtained by signing a challenge with a key it generated itself.',
        error: false,
      });
    } catch (error) {
      setOutcome({ text: errorText(error), error: true });
    } finally {
      setBusy(false);
    }
  }, [claim]);

  return (
    <Step
      n={7}
      optional
      title="Connect this account to your cloud"
      state={claimed ? 'done' : 'idle'}
      stateLabel={claimed ? (claim.linked ? 'connected' : 'proven, unlinked') : 'not yet'}
      why={
        <>
          <strong>Nothing above this needs it</strong>, which is why it is last: routing reads
          prove themselves with the device certificate, the node session comes from the device
          key, and the write is authorised by a warrant. It used to sit at step 2, where being
          second of six read as required.{' '}
          Two steps, and they answer different questions.{' '}
          <strong>Connect</strong> sends you to the cloud to sign in and agree to link this account
          — the half that needs you to <em>be</em> the cloud customer, which a tab holding only a
          key can never be. You come back with a <em>grant</em>: consent to link this one account,
          worthless to anyone who cannot sign with its root.{' '}
          <strong>Prove</strong> is the other half. Every other proof on this page is signed by the{' '}
          <strong>device</strong> key and rests on a certificate the root issued — and a certificate
          is <em>public</em>, so the strongest thing any of them can say is &ldquo;a device of this
          account is asking&rdquo;. Only the <strong>root</strong> can say the account is yours.
        </>
      }
    >
      <label>
        Cloud portal URL — where you sign in
        <input
          type="text"
          value={settings.portalUrl}
          placeholder={DEFAULT_PORTAL_URL}
          onChange={(e) => onChange({ portalUrl: e.target.value.trim() })}
        />
      </label>
      <p className="aside">
        A second host, not a second spelling of the API URL in step 2: production serves the
        sign-in page from <code>{settings.portalUrl || DEFAULT_PORTAL_URL}</code>, which does not
        proxy <code>/api/*</code>, and answers the API from{' '}
        <code>{settings.cloudUrl || DEFAULT_CLOUD_URL}</code>, which has no sign-in page. Deriving
        one from the other would work in exactly the deployments where it did not matter.
      </p>

      <div className="row">
        <button type="button" onClick={connectCloud} disabled={busy || !identity}>
          {busy ? 'Working…' : linked ? 'Connect a different login' : 'Connect to my cloud'}
        </button>
        <button type="button" onClick={() => void connect()} disabled={busy || !identity}>
          {busy ? 'Proving…' : claimed ? 'Prove this account again' : 'Prove I own this account'}
        </button>
        <button
          type="button"
          className="secondary"
          onClick={() => void fetchNamespaces()}
          disabled={busy || claim === null || claim.sessionToken === ''}
        >
          {busy ? 'Asking the cloud…' : 'Fetch my namespaces with it'}
        </button>
      </div>

      <p className="aside">
        The round trip exists because only Google issues a <em>first</em> cloud session, and
        linking lives behind one. So the consent is collected where you are signed in, and what
        crosses back is a grant rather than a session token — it authorises exactly one link, on
        one named account, and a grant someone intercepts links nothing without your root
        signature. It arrives in the URL fragment, which browsers never send to servers.
      </p>

      {claimed && (
        <dl className="kv">
          <dt>account</dt>
          <dd>{claim.accountId}</dd>
          <dt>cloud</dt>
          <dd>{claim.cloudUrl}</dd>
          <dt>proved</dt>
          <dd>{new Date(claim.provenAt).toLocaleString()}</dd>
          <dt>session</dt>
          <dd>
            {claim.linked
              ? `held, as ${claim.email}`
              : 'none — the claim is recorded, the account is not linked to a cloud login'}
          </dd>
        </dl>
      )}

      {result !== null && (
        <>
          <dl className="kv">
            <dt>challenge</dt>
            <dd>
              {short(result.nonce, 12)} — expires{' '}
              {new Date(result.expiresAtMs).toLocaleTimeString()}
            </dd>
            <dt>signed by</dt>
            <dd>
              the <strong>account root</strong> {short(result.rootPublicKey, 12)} —{' '}
              {short(result.signature, 12)}
            </dd>
          </dl>
          <p className="aside">
            No account id was sent. The account <em>is</em> the hash of the root public key, so
            the cloud derives it from the key it just verified — there is no field a caller could
            state that the signature would then contradict.
          </p>
        </>
      )}

      {namespaces !== null && (
        <ul className="nodes">
          {namespaces.length === 0 ? (
            <li>
              none — an empty list is still a signed-in answer, and a 401 is what an unproven
              caller gets
            </li>
          ) : (
            namespaces.map((id) => (
              <li key={id}>
                <code>{id}</code>
              </li>
            ))
          )}
        </ul>
      )}

      {claimed && !claim.linked && (
        <p className="aside">
          <strong>Proven, not entitled.</strong> The proof establishes <em>who</em>; the link
          establishes <em>what you are entitled to</em>. Anyone can mint an account root offline,
          so a session on the proof alone would authenticate perfectly and authorize nothing — no
          cloud user, no plan, no namespaces to scope it to. The claim is written down anyway, so
          linking this account from a signed-in cloud session later needs no second proof.
        </p>
      )}

      <p className="aside">
        <strong>
          This demo keeps your account root in <code>localStorage</code>, and a product must not.
        </strong>{' '}
        The claim is a root signature, so a tab that dropped the root could make it exactly once
        and never again without re-entering 24 words. A stolen device key is revocable; a stolen
        root is the account, permanently. Keep the root in a desktop app, a hardware key or an OS
        keychain and sign the challenge there — mero-js splits <code>signAccountLogin</code> out
        from <code>signInWithAccount</code> so the secret never has to reach the browser at all.
      </p>

      {identity && rootSecret === '' && (
        <p className="aside">
          This identity predates the page keeping a root, so there is nothing here to sign the
          claim with. Everything else still works — the device key signs sessions, joins and
          warrants. Restore from your phrase to claim the account.
        </p>
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
      n={4}
      title="Obtain a session — no password"
      state={session ? 'done' : 'idle'}
      stateLabel={session ? 'open' : 'closed'}
      why={
        <>
          The node issues a challenge; the device key signs a statement naming this
          origin, that challenge and a freshly minted session key; the node returns a
          token. The device key never leaves the tab, and the token authorises reads
          only — <code>context:query</code>, <code>context:intent</code> and{' '}
          <code>context:subscribe</code>, which is deliberately the whole delegated
          surface and nothing above it.
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

      {!enabled && (
        <p className="aside">
          Needs a relay from step 2 and a pinned key from step 3 — the statement names both, so
          neither can be filled in later.
        </p>
      )}

      <Out error={outcome?.error}>{outcome?.text ?? ''}</Out>

      {outcome?.error ? (
        <div className="note">
          A 401 here is usually one of three things, and the node cannot tell you which:
          the <strong>audience</strong> (<code>{window.location.origin}</code>) is not in
          the node&rsquo;s <code>allowed_audiences</code>, the{' '}
          <strong>node key</strong> from step 3 is not the one the node signs with, or the
          provider is not enabled at all. The README says how to check each.
        </div>
      ) : null}
    </Step>
  );
}

/**
 * Read — and the panel that owns the context id, because this is where it is
 * first used.
 *
 * ## Why it is still typed
 *
 * Every other identifier on the page became derivable: the namespace comes out
 * of the invitation, the relay out of the cloud. A context id does not, and the
 * reason is worth stating rather than leaving as an unexplained text box.
 *
 * The invitation does not carry one — it is an invitation to a *group*, and the
 * contexts under it change after it is minted. The cloud answers
 * `GET /api/cloud/me/namespaces/{ns}/contexts`, but only for a namespace the
 * caller *owns*, and a delegated keyholder is a member of somebody else's
 * namespace by definition. The authoritative answer is the node's own
 * `GET /admin-api/contexts`, which core already scopes to the calling account
 * — but that route needs `context:list`, and an `account_proof` session is
 * minted with `context:query`, `context:intent` and `context:subscribe` and
 * deliberately nothing else.
 *
 * So the value is pasted here and grouped with the invitation as something
 * handed to you, which is what it is today.
 */
function ReadStep({
  settings,
  onChange,
  session,
  enabled,
}: {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  session: DelegatedSession | null;
  enabled: boolean;
}) {
  const { outcome, busy, run } = useOutcome();
  const [key, setKey] = useState('delegated');

  return (
    <Step
      n={5}
      title="Read the context"
      state={enabled ? 'idle' : 'blocked'}
      stateLabel={settings.contextId.trim().length === 64 ? undefined : 'no context yet'}
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
      <Provenance
        kind="given"
        title="The context, handed to you with the invitation"
        note={
          <>
            The last identifier on this page that cannot be discovered. An invitation names a
            group, not a context; the cloud lists contexts only for a namespace you{' '}
            <em>own</em>, and a delegated keyholder owns none; and the node&rsquo;s own listing
            needs <code>context:list</code>, which an <code>account_proof</code> session is
            deliberately not given. Ask whoever invited you.
          </>
        }
      >
        <label>
          Context id — 64 hex
          <input
            type="text"
            value={settings.contextId}
            placeholder="89ab…"
            onChange={(e) => onChange({ contextId: e.target.value.trim() })}
          />
        </label>
      </Provenance>

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

  // The relay the cloud resolved, falling back to the admitter. The fallback is
  // for the manual path — settings typed by hand, or restored from a blob
  // written before this field existed — and NOT a default for the discovered
  // case: step 2 leaves `relayUrl` empty on purpose when no node holds the
  // authorship grant, and silently posting to the admitter there is exactly the
  // bug this split fixes. It fails at the relay with a clear refusal instead.
  const writeUrl = settings.relayUrl || settings.nodeUrl;

  return (
    <Step
      n={6}
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
      <dl className="kv">
        <dt>relay</dt>
        <dd>
          {writeUrl === '' ? (
            <em>none resolved — run step 2, or set a node URL by hand</em>
          ) : (
            <>
              {writeUrl}
              {settings.relayUrl === '' ? ' (the admitter, no cloud-resolved relay)' : ''}
              {settings.relayUrl !== '' && settings.relayUrl !== settings.nodeUrl
                ? ' (a different node from the one that admitted you)'
                : ''}
            </>
          )}
        </dd>
      </dl>
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
              const described = await describeRelay(writeUrl, settings.contextId);
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
                writeUrl,
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
