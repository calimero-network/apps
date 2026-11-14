import "./nodeShield.css";
import "./workspaceReview.css";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { CalimeroClient, NodeVerificationState, PackageCapabilities } from "@calimero-network/mero-js";

import { useAppCode, useNodeVerification } from "./nodeChecks";
import { useShieldStore } from "./nodeShieldStore";
import { ExternalIcon, ShieldIcon, Tick } from "./shieldIcons";
import { describeShield, hostOf } from "./shieldView";
import {
  abiFileName,
  actionCount,
  actionGroups,
  codeLine,
  dataStatements,
  exceptions,
  rawFacts,
  shortSigner,
  summarize,
  type ActionGroup,
  type ActionView,
  type GroupId,
  type SummaryLine,
} from "./workspaceFacts";

const COPIED_MS = 2_000;
const OPEN_GROUP_MAX = 3; // a longer group starts closed
const ICONS = {
  key: ["M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.78 7.78 5.5 5.5 0 0 1 7.78-7.78zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3m-3.5 3.5L19 4"],
  globe: ["M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z", "M2 12h20", "M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"],
  out: ["M7 17 17 7M7 7h10v10"],
  clock: ["M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z", "M12 6v6l4 2"],
  check: ["m5 12.5 4.5 4.5L19 7.5"],
  link: ["M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"],
  pencil: ["M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"],
  eye: ["M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z", "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"],
  bell: ["M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0"],
  dots: ["M5 12h.01M12 12h.01M19 12h.01"],
  warn: ["M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z", "M12 9v4M12 17h.01"],
} as const;
type IconName = keyof typeof ICONS;

const SUMMARY_ICON = (line: SummaryLine): IconName => {
  const icons: Record<SummaryLine["id"], IconName> = { passkey: "key", public: "globe", outside: "out", timers: "clock", apps: line.tone === "ok" ? "check" : "link" };
  return icons[line.id];
};
const GROUP_ICON: Record<GroupId, IconName> = { passkey: "key", public: "globe", changes: "pencil", reads: "eye", timers: "clock", outside: "out", events: "bell", other: "dots" };

/** The package release the review is about. */
export interface ReviewRelease {
  package: string;
  version: string;
}

type CardState = { status: "loading" } | { status: "ready"; card: PackageCapabilities } | { status: "error"; message: string };

/** The release's capability card from the node the session talks to, asked only once the node's own check verified it, and again on `retry`. */
function useCard(client: CalimeroClient | null, release: ReviewRelease, node: NodeVerificationState): [CardState, () => void] {
  const [state, setState] = useState<CardState>({ status: "loading" });
  const [round, setRound] = useState(0);
  const gate = node.status === "verified" ? "verified" : node.status === "refused" ? "refused" : "waiting";
  useEffect(() => {
    if (!client) {
      setState({ status: "error", message: "not connected to a node" });
      return;
    }
    if (gate !== "verified") {
      setState(gate === "refused" ? { status: "error", message: "this node did not pass its check" } : { status: "loading" });
      return;
    }
    let live = true;
    setState({ status: "loading" });
    client.packageCapabilities(release.package, release.version).then(
      (card) => live && setState({ status: "ready", card }),
      (e: unknown) => live && setState({ status: "error", message: e instanceof Error ? e.message : String(e) }),
    );
    return () => {
      live = false;
    };
  }, [client, release.package, release.version, round, gate]);
  return [state, useCallback(() => setRound((n) => n + 1), [])];
}

function Icon({ name }: { name: IconName }) {
  return (
    <svg className="cp-review__icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICONS[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <button type="button" className="cp-review__copy" aria-label={label} onClick={() => void navigator.clipboard.writeText(text).then(() => setCopied(true), () => undefined)}>
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function downloadAbi(card: PackageCapabilities) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(card.abi, null, 2)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = abiFileName(card);
  link.click();
  setTimeout(() => URL.revokeObjectURL(url));
}

function Facts({ facts }: { facts: Array<{ label: string; value: string; mono?: boolean }> }) {
  return (
    <dl className="cp-review__kv">
      {facts.map((f) => (
        <div key={f.label}>
          <dt>{f.label}</dt>
          <dd className={f.mono ? "cp-review__mono" : undefined}>{f.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function ActionRow({ item, mono }: { item: ActionView; mono: boolean }) {
  const title = <span className={mono ? "cp-review__act-title cp-review__mono" : "cp-review__act-title"}>{item.title}</span>;
  const tags = (
    <span className="cp-review__tags">
      {item.tags.map((tag) => (
        <span key={tag} className={`cp-review__tag cp-review__tag--${tag.split(" ")[0]}`}>
          {tag}
        </span>
      ))}
    </span>
  );
  if (item.facts.length === 0 && !item.doc) {
    return (
      <div className="cp-review__act cp-review__act--flat">
        <div className="cp-review__act-head">
          {title}
          {tags}
        </div>
      </div>
    );
  }
  return (
    <details className="cp-review__act">
      <summary>
        {title}
        {tags}
      </summary>
      <div className="cp-review__facts">
        <Facts facts={item.facts} />
        {item.doc && (
          <div className="cp-review__said" data-publisher="">
            <span>Publisher&apos;s description</span>
            <p>{item.doc}</p>
          </div>
        )}
      </div>
    </details>
  );
}

function GroupView({ group, filtered }: { group: ActionGroup; filtered: boolean }) {
  return (
    <details className="cp-review__grp" open={filtered || group.items.length <= OPEN_GROUP_MAX}>
      <summary>
        <Icon name={GROUP_ICON[group.id]} />
        <span className="cp-review__grp-text">
          <b>{group.label}</b>
          <span>{group.blurb}</span>
        </span>
        <span className="cp-review__count">{group.items.length}</span>
      </summary>
      <div className="cp-review__acts">
        {group.items.map((item) => (
          <ActionRow key={item.name} item={item} mono={group.id === "outside"} />
        ))}
      </div>
    </details>
  );
}

function AllActions({ card, signed }: { card: PackageCapabilities; signed: boolean }) {
  const groups = actionGroups(card);
  const [only, setOnly] = useState<GroupId | null>(null);
  const count = actionCount(card.abi);
  if (groups.length === 0) return null;
  return (
    <details className="cp-review__more">
      <summary>
        <span>{count > 0 ? `See all ${count} ${count === 1 ? "action" : "actions"}` : "See details"}</span>
      </summary>
      <div className="cp-review__chips" role="group" aria-label="Filter actions">
        <button type="button" className="cp-review__chip" aria-pressed={only === null} onClick={() => setOnly(null)}>
          All
        </button>
        {groups.map((g) => (
          <button key={g.id} type="button" className="cp-review__chip" aria-pressed={only === g.id} onClick={() => setOnly(g.id)}>
            {`${g.chip} (${g.items.length})`}
          </button>
        ))}
      </div>
      {groups
        .filter((g) => only === null || g.id === only)
        .map((g) => (
          <GroupView key={g.id} group={g} filtered={only !== null} />
        ))}
      <p className="cp-review__note">Tags and facts come from {signed ? "the app's signed release" : "the release as this test server lists it"}. The publisher&apos;s description is the publisher&apos;s own words and is not checked.</p>
    </details>
  );
}

function SignedFacts({ card, signed }: { card: PackageCapabilities; signed: boolean }) {
  return (
    <details className="cp-review__more">
      <summary>
        <span>{signed ? "Signed facts" : "Facts as this test server lists them"}</span>
      </summary>
      <dl className="cp-review__kv cp-review__kv--raw">
        {rawFacts(card).map((f) => (
          <div key={f.label}>
            <dt>{f.label}</dt>
            <dd className="cp-review__mono">{f.value}</dd>
          </div>
        ))}
      </dl>
      {card.abi ? (
        <button type="button" className="cp-review__btn" onClick={() => downloadAbi(card)}>
          Download full ABI (JSON)
        </button>
      ) : (
        <p className="cp-review__muted">There is no action list to download.</p>
      )}
    </details>
  );
}

function Section({ title, kind, children }: { title: string; kind?: React.ComponentProps<typeof ShieldIcon>["kind"]; children: React.ReactNode }) {
  const id = useId();
  return (
    <section className="cp-review__sec" aria-labelledby={id}>
      <h3 id={id} className="cp-review__h" data-kind={kind}>
        {kind && <ShieldIcon kind={kind} />}
        {title}
      </h3>
      {children}
    </section>
  );
}

/** The four sections. With `appId` the instance exists, and its code is checked against the release. */
function ReviewBody({ release, appId }: { release: ReviewRelease; appId?: string }) {
  const { sessions } = useShieldStore();
  const session = sessions[sessions.length - 1] ?? null;
  const client = session?.client ?? null;
  const [state] = useNodeVerification(client);
  const [loaded, retry] = useCard(client, release, state);
  const app = useMemo(() => (appId ? { id: appId, source: { package: release.package, version: release.version } } : null), [appId, release.package, release.version]);
  const checked = useAppCode(client, app, state.status === "verified" ? state.url : null);
  const view = describeShield(state, { cluster: session?.cluster ?? "", code: checked });

  const card = loaded.status === "ready" ? loaded.card : null;
  const sealed = view.kind === "verified";
  const release_ = state.status === "verified" && !state.mock ? state.release : undefined;
  const code = card ? codeLine(card, app ? (checked ?? "pending") : null, sealed) : null;
  const diverged = code?.tone === "bad";
  const summary = card ? summarize(card, sealed) : [];
  const unknown = !card
    ? "What leaves the sealed hardware is not known until the app's details load."
    : !card.abi
      ? "This app publishes no action list, so what it makes visible to anyone is not known."
      : null;

  return (
    <>
      {loaded.status === "error" && (
        <div className="cp-review__alert" role="alert">
          <p>
            The review of this app could not load ({loaded.message}).{appId ? "" : " You can still create the workspace."}
          </p>
          <button type="button" className="cp-review__btn" onClick={retry}>
            Try again
          </button>
        </div>
      )}

      <Section title="The app">
        <dl className="cp-review__kv">
          <div>
            <dt>App</dt>
            <dd>{`${card?.name ?? release.package} v${release.version}`}</dd>
          </div>
          {card && (
            <div>
              <dt>Publisher</dt>
              <dd>
                <span className="cp-review__mono" title={card.signer}>
                  {shortSigner(card.signer)}
                </span>
                <CopyButton text={card.signer} label="Copy publisher" />
              </dd>
            </div>
          )}
          {code && (
            <div>
              <dt>Code</dt>
              <dd className={code.tone ? `cp-review__tone--${code.tone}` : undefined}>
                <span>{code.text}</span>
                {code.note && <span className="cp-review__sub">{code.note}</span>}
              </dd>
            </div>
          )}
        </dl>
      </Section>

      <Section title="What it can do">
        {loaded.status === "loading" && (
          <p className="cp-review__muted" role="status">
            Loading what this app can do…
          </p>
        )}
        {loaded.status === "error" && <p className="cp-review__muted">Not available until the review loads.</p>}
        {card && (
          <>
            {summary.length > 0 && (
              <ul className="cp-review__sum">
                {summary.map((line) => (
                  <li key={line.id} data-tone={line.tone}>
                    <span className="cp-review__ic">
                      <Icon name={SUMMARY_ICON(line)} />
                    </span>
                    <span className="cp-review__tx">
                      <b>{line.title}</b>
                      <span>{line.detail}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {!card.abi && <p className="cp-review__muted">This app publishes no action list.</p>}
            <AllActions card={card} signed={sealed} />
            <SignedFacts card={card} signed={sealed} />
          </>
        )}
      </Section>

      <Section title="Where it runs" kind={view.kind}>
        <dl className="cp-review__kv">
          <div>
            <dt>Cluster</dt>
            <dd>{session?.cluster}</dd>
          </div>
          <div>
            <dt>Nodes</dt>
            <dd>{client ? `${client.nodes.length} ${client.nodes.length === 1 ? "node" : "nodes"}` : ""}</dd>
          </div>
          {release_ && (
            <div>
              <dt>Software</dt>
              <dd>
                <span className="cp-review__mono">{`mero-tee v${release_}`}</span>
                {view.verifyUrl && (
                  <a className="cp-review__link" href={view.verifyUrl} target="_blank" rel="noopener noreferrer" title="Opens the public verifier, which re-checks this node from outside the app">
                    Verify
                    <ExternalIcon />
                  </a>
                )}
              </dd>
            </div>
          )}
          {!sealed && (
            <div>
              <dt>Status</dt>
              <dd>{view.title}</dd>
            </div>
          )}
          {state.status === "verified" && (
            <div>
              <dt>Node</dt>
              <dd className="cp-review__mono">{hostOf(state.url)}</dd>
            </div>
          )}
        </dl>
      </Section>

      <Section title="Your data" kind={view.kind}>
        {diverged ? (
          <p className="cp-review__grey" data-kind="refused">
            <b>Code does not match the release</b>
            <span>This node runs other code than the signed release, so no statement about your data is made here.</span>
          </p>
        ) : sealed ? (
          <>
            <ul className="cp-review__claims">
              {dataStatements(view.kind).map((text) => (
                <li key={text}>
                  <Tick />
                  <b>{text}</b>
                </li>
              ))}
            </ul>
            <details className="cp-review__how">
              <summary>
                <span>How we know</span>
              </summary>
              <ul>
                {release_ && <li>{`Runs Calimero's published, signed node software (release v${release_})`}</li>}
                {view.checks.map((text) => (
                  <li key={text}>{text}</li>
                ))}
              </ul>
            </details>
            {card && exceptions(card).length > 0 && (
              <ul className="cp-review__except">
                {exceptions(card).map((text) => (
                  <li key={text}>
                    <Icon name="warn" />
                    {text}
                  </li>
                ))}
              </ul>
            )}
            {unknown && <p className="cp-review__muted">{unknown}</p>}
          </>
        ) : (
          <p className="cp-review__grey" data-kind={view.kind}>
            <b>{view.title}</b>
            <span>{view.sub}</span>
          </p>
        )}
      </Section>
    </>
  );
}

export interface WorkspaceReviewProps {
  /** The package release the workspace will run. */
  release: ReviewRelease;
  /** The workspace is being created: both buttons wait. */
  creating?: boolean;
  onBack: () => void;
  onCreate: () => void;
}

/**
 * Step 2 of creating a workspace: what the app is, what it can do, where it
 * runs and what that means for the data, from the release's signed capability
 * card and the node's own check. Read by the person before "Create workspace".
 * Needs a session bound by `usePasskeySession`.
 */
export function WorkspaceReview({ release, creating = false, onBack, onCreate }: WorkspaceReviewProps) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);
  return (
    <div className="cp-review">
      <h2 ref={heading} tabIndex={-1} className="cp-review__title">
        Review before creating
      </h2>
      <p className="cp-review__lede">Check what this app can do and where it will run before you create the workspace.</p>
      <ReviewBody release={release} />
      <div className="cp-review__buttons">
        <button type="button" className="cp-review__btn" disabled={creating} onClick={onBack}>
          Back
        </button>
        <button type="button" className="cp-review__btn cp-review__btn--primary" disabled={creating} onClick={onCreate}>
          {creating ? "Creating…" : "Create workspace"}
        </button>
      </div>
    </div>
  );
}

export interface WorkspaceTrustProps {
  /** The release the workspace's instance runs. */
  release: ReviewRelease;
  /** The workspace's app instance, whose code the node attests. */
  appId: string;
}

/** The review again for a workspace that exists, for its settings: members who join later see the same facts, with the node's own check of the instance's code. */
export function WorkspaceTrust({ release, appId }: WorkspaceTrustProps) {
  return (
    <div className="cp-review">
      <h2 className="cp-review__title">Trust</h2>
      <p className="cp-review__lede">What this workspace&apos;s app can do and where it runs. Members who join later can check the same facts.</p>
      <ReviewBody release={release} appId={appId} />
    </div>
  );
}
