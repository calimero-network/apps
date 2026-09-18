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
import type { AccountClaimResult, AccountProofResult } from './lib/flow.js';
import {
  claimAccountWithCloud,
  cloudNamespacesForSession,
  finishCloudLink,
  startCloudLink,
  describeRelay,
  discoverAdmitter,
  proveAccountToCloud,
  sendJoin,
  openSession,
  readContext,
  writeContext,
} from './lib/flow.js';
import { errorText, parseJson, pretty, short } from './lib/format.js';
import { CloudClient } from '@calimero-network/mero-js';
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
      n={2}
      title="Connect this account to your cloud"
      state={claimed ? 'done' : 'idle'}
      stateLabel={claimed ? (claim.linked ? 'connected' : 'proven, unlinked') : 'not yet'}
      why={
        <>
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
        Cloud API URL
        <input
          type="text"
          value={settings.cloudUrl}
          placeholder={DEFAULT_CLOUD_URL}
          onChange={(e) => onChange({ cloudUrl: e.target.value.trim() })}
        />
      </label>
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
        Both are prefilled with the hosted cloud and both are editable — point them at a local or
        staging cloud and the rest of the page follows. Two fields because they are two hosts: the
        portal serves the sign-in page and does not proxy <code>/api/*</code>, and the API host has
        no sign-in page.
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
          linking this account from a signed-in cloud session later needs no second proof. The
          rest of this page does not need the session: routing reads prove themselves.
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
   * prove which account is asking. So step 3 now depends on step 1, which is
   * the honest ordering: there was never a point in resolving a node before
   * holding the key that will sign the join.
   */
  identity: DeviceIdentity | null;
}) {
  const [classified, setClassified] = useState<ClassifiedNode[]>([]);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [busy, setBusy] = useState(false);
  const [joined, setJoined] = useState(false);
  const [proof, setProof] = useState<AccountProofResult | null>(null);

  const prove = useCallback(async () => {
    setBusy(true);
    setOutcome(null);
    try {
      if (!identity) throw new Error('Mint or restore an account in step 1 first.');
      if (settings.namespaceId.trim() === '') throw new Error('Enter the namespace id first.');
      const result = await proveAccountToCloud(settings.cloudUrl, settings.namespaceId, identity);
      setProof(result);
      setOutcome({
        text:
          `The cloud served this read as ${short(result.accountId, 10)} rather than anonymously, ` +
          `and answered with ${result.nodeCount} node(s).`,
        error: false,
      });
    } catch (error) {
      setProof(null);
      setOutcome({ text: error instanceof Error ? error.message : String(error), error: true });
    } finally {
      setBusy(false);
    }
  }, [identity, settings.cloudUrl, settings.namespaceId]);

  const join = useCallback(async () => {
    setBusy(true);
    setOutcome(null);
    try {
      if (!identity) throw new Error('Mint or restore an account in step 1 first.');
      if (settings.admitUrl === '') throw new Error('Find an admitter first — the button above.');
      const { published } = await sendJoin(
        settings.admitUrl,
        identity,
        settings.namespaceId,
        settings.invitationJson,
      );
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
      setOutcome({ text: error instanceof Error ? error.message : String(error), error: true });
    } finally {
      setBusy(false);
    }
  }, [identity, settings.admitUrl, settings.namespaceId, settings.invitationJson]);

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
      // Two fields, because they answer two questions. The write leg used to
      // reuse `nodeUrl` even when the panel had just said this node cannot
      // execute — it told you the problem and then walked into it.
      const relayUrl = result.executor?.relayUrl ?? '';
      onChange({
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
      setOutcome({ text: error instanceof Error ? error.message : String(error), error: true });
    } finally {
      setBusy(false);
    }
  }, [settings.cloudUrl, settings.namespaceId, settings.invitationJson, identity, onChange]);

  return (
    <Step
      n={3}
      title="Prove your account to the cloud, and accept an invitation"
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

      <div className="row">
        <button type="button" onClick={() => void prove()} disabled={busy || !identity}>
          {busy ? 'Proving…' : 'Prove my account to the cloud'}
        </button>
        <button type="button" onClick={discover} disabled={busy || !identity}>
          {busy ? 'Asking the cloud…' : 'Find a node that can admit me'}
        </button>
        <button
          type="button"
          onClick={() => void join()}
          disabled={busy || !identity || settings.admitUrl === ''}
        >
          {busy ? 'Signing and sending…' : joined ? 'Join sent — send again' : 'Sign and send my join'}
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
            Three steps, and the middle one is the one that matters: the cloud minted a sealed
            challenge bound to this namespace, your <strong>device</strong> key signed it, and the
            routing read went through naming that account. The certificate alone would prove
            nothing — it travels in the clear inside every device-link op, so anyone who has seen
            one could present it. Only this signature binds you to the device.
          </p>
          <p className="aside">
            Nothing was stored and no session was issued. A challenge expires in about two minutes
            and every routing read proves itself again, which is why this button demonstrates
            rather than connects. What it buys the cloud is <em>attribution</em>: this read can be
            rate-limited to an account instead of being anonymous. It does <strong>not</strong>
            prove you were invited or are a member — the cloud cannot know either, and anyone can
            mint an account offline. That check lives at the node, on the signed op.
          </p>
        </>
      )}

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
      n={4}
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
      n={5}
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

  // The relay the cloud resolved, falling back to the admitter. The fallback is
  // for the manual path — settings typed by hand, or restored from a blob
  // written before this field existed — and NOT a default for the discovered
  // case: step 3 leaves `relayUrl` empty on purpose when no node holds the
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
            <em>none resolved — run step 3, or set a node URL by hand</em>
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
