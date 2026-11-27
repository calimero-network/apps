import { useEffect, type ReactNode } from "react";
import { REPO_URL } from "./Landing";

export type InfoDoc = "faq" | "terms" | "privacy";

export const INFO_DOCS: { doc: InfoDoc; label: string; title: string }[] = [
  { doc: "faq", label: "FAQ", title: "Sylence FAQ" },
  { doc: "privacy", label: "Privacy", title: "Sylence privacy policy" },
  { doc: "terms", label: "Terms", title: "Sylence terms of use" },
];

const UPDATED = "November 27, 2026";
const ISSUES_URL = "https://github.com/calimero-network/apps/issues";

function Ext({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  );
}

/** FAQ, privacy policy or terms, in the landing page's frame. */
export function InfoPage({ doc }: { doc: InfoDoc }) {
  const meta = INFO_DOCS.find((d) => d.doc === doc)!;
  useEffect(() => {
    const before = document.title;
    document.title = meta.title;
    if (!navigator.userAgent.includes("jsdom")) window.scrollTo(0, 0);
    return () => {
      document.title = before;
    };
  }, [meta.title]);

  return (
    <article className="info" aria-labelledby="info-title" data-testid={`info-${doc}`}>
      <nav className="info-tabs" aria-label="Help and legal">
        {INFO_DOCS.map((d) => (
          <a key={d.doc} href={`#/${d.doc}`} aria-current={d.doc === doc ? "page" : undefined}>
            {d.label}
          </a>
        ))}
      </nav>
      {doc === "faq" && <Faq />}
      {doc === "privacy" && <Privacy />}
      {doc === "terms" && <Terms />}
    </article>
  );
}

function Head({ eyebrow, title, lede }: { eyebrow: string; title: string; lede: ReactNode }) {
  return (
    <header className="info-head">
      <span className="install-eyebrow">{eyebrow}</span>
      <h1 id="info-title">{title}</h1>
      <p className="lede">{lede}</p>
    </header>
  );
}

const FAQ: { q: string; a: ReactNode }[] = [
  {
    q: "What does Sylence record?",
    a: (
      <p>
        The audio of the browser tab you choose, and your microphone if you allow it. Nothing is recorded until you open
        Sylence on that tab and press Record meeting, and it stops when you press Stop or close the tab.
      </p>
    ),
  },
  {
    q: "Does a bot join the call?",
    a: <p>No. Sylence works inside your own browser tab, so nobody else in the call sees a new participant.</p>,
  },
  {
    q: "Where does the audio go?",
    a: (
      <p>
        To your own workspace, sealed. Speech becomes text on your laptop first: a large Whisper model on the GPU where
        your laptop has one, a smaller model on the CPU otherwise. The audio and the transcript are then saved to your
        workspace on a Calimero node that runs in a secure enclave, so only your workspace's members can play or read
        them. Calimero and the cloud host cannot.
      </p>
    ),
  },
  {
    q: "Where are transcripts kept, and who can read them?",
    a: (
      <p>
        In the workspace you pick, on your organization's Calimero nodes, which run in secure enclaves: sealed hardware
        that keeps the data encrypted while it is stored and used. Only the members of that workspace can read the
        transcripts, play the audio, search them and tick off action items. Calimero cannot read them.
      </p>
    ),
  },
  {
    q: "Which call apps and browsers does it work with?",
    a: (
      <p>
        Google Meet, Zoom and Microsoft Teams in the browser, or any tab that plays a call. Sylence runs in Chrome,
        Brave and Edge on a desktop or laptop. Firefox, Safari and phones are not supported.
      </p>
    ),
  },
  {
    q: "How does it know who said what?",
    a: (
      <p>
        While it records, Sylence reads which participant the call page shows as speaking, and labels each line with
        that name. Each speaker also gets a colour, always shown next to their name.
      </p>
    ),
  },
  {
    q: "Do I need an account?",
    a: (
      <p>
        Yes, a Calimero account and a workspace. You sign in with a passkey, so there is no password to remember. The
        first time you record, the speech model downloads once and stays in your browser.
      </p>
    ),
  },
  {
    q: "What are Smart notes?",
    a: (
      <p>
        An experimental option, off by default, that writes a summary and action items after the call. It uses a small
        AI model that also runs on your laptop.
      </p>
    ),
  },
  {
    q: "Can I export or delete a meeting?",
    a: (
      <p>
        Every meeting can be copied or downloaded as Markdown. The person who recorded it, or the workspace's owner, can
        delete it, which removes its transcript and action items from the workspace.
      </p>
    ),
  },
  {
    q: "Why do I install it by hand?",
    a: (
      <p>
        Until Sylence is in the Chrome Web Store, it installs as an unpacked extension. The{" "}
        <a href="#/install">install page</a> walks through it in five steps. To update, download it again and replace
        the folder.
      </p>
    ),
  },
  {
    q: "Is it open source?",
    a: (
      <p>
        Yes. The extension, the page and the workspace logic are all on <Ext href={REPO_URL}>GitHub</Ext>. Questions and
        bug reports go to the <Ext href={ISSUES_URL}>issue tracker</Ext>.
      </p>
    ),
  },
];

function Faq() {
  return (
    <>
      <Head
        eyebrow="FAQ"
        title="Questions, answered"
        lede="How Sylence records, where your recordings and transcripts live, and who can read them."
      />
      <div className="faq">
        {FAQ.map((item) => (
          <details key={item.q} className="faq-item">
            <summary>
              <span>{item.q}</span>
              <svg className="faq-chev" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  d="m6 9 6 6 6-6"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </summary>
            <div className="faq-a">{item.a}</div>
          </details>
        ))}
      </div>
    </>
  );
}

function Privacy() {
  return (
    <>
      <Head
        eyebrow="Privacy"
        title="Privacy policy"
        lede={`The short version: the audio and the transcript go only to your own workspace, sealed in a secure enclave that only its members can read. Last updated ${UPDATED}.`}
      />
      <div className="prose">
        <p>
          Sylence is a browser extension and web page by Calimero that transcribes calls you choose to record. This
          policy covers both.
        </p>
        <h2>Audio</h2>
        <p>
          Sylence captures the audio of the tab you record and, if you allow it, your microphone. The audio is turned
          into text on your device. The audio is then saved with the transcript to your workspace, in a secure enclave,
          and is never shared with anyone outside it.
        </p>
        <h2>What is saved, and where</h2>
        <p>
          The audio, the transcript text, the speaker names the call page shows, the meeting's title, platform and link,
          any summary, and action items are saved to the Calimero workspace you chose, on your organization's Calimero
          nodes. Those nodes run in secure enclaves, which keep the data encrypted so that neither Calimero nor the cloud
          host can read it. Who can read it is decided by your workspace's members and permissions.
        </p>
        <h2>On your device</h2>
        <p>
          Your settings, your Calimero session and lines waiting to upload are kept in the extension's storage in your
          browser. The speech and notes models are kept in your browser's cache.
        </p>
        <h2>Third parties</h2>
        <p>
          The models download from Hugging Face (huggingface.co). Hugging Face sees your IP address and which file was
          downloaded, never audio or transcripts. Nothing else is sent to third parties. Sylence has no ads and no
          analytics, and does not sell data.
        </p>
        <h2>Deleting data</h2>
        <p>
          Delete a meeting on the Sylence page to remove its audio, transcript and action items from the workspace. Removing
          the extension deletes everything it keeps in your browser.
        </p>
        <h2>Changes and contact</h2>
        <p>
          If this policy changes, the new version is posted here with a new date. Questions go to the{" "}
          <Ext href={ISSUES_URL}>Sylence issue tracker</Ext>.
        </p>
      </div>
    </>
  );
}

function Terms() {
  return (
    <>
      <Head
        eyebrow="Terms"
        title="Terms of use"
        lede={`The rules for using Sylence, in plain language. Last updated ${UPDATED}.`}
      />
      <div className="prose">
        <h2>The service</h2>
        <p>
          Sylence is a browser extension and web page by Calimero that turns calls you record into transcripts and
          action items, saved to a workspace on Calimero. By installing the extension or using the page, you agree to
          these terms and to the <a href="#/privacy">privacy policy</a>.
        </p>
        <h2>Recording other people</h2>
        <p>
          Recording a conversation can require the consent of everyone in it, depending on where you and they are. You
          are responsible for telling the people in your call that you are transcribing it and for getting any consent
          the law or your organization requires. Do not use Sylence to record anyone without permission.
        </p>
        <h2>Your content</h2>
        <p>
          Transcripts, summaries and action items belong to you and your organization. Calimero does not claim any
          rights to them and does not read them. You are responsible for what you record and share in your workspace.
        </p>
        <h2>Acceptable use</h2>
        <p>
          Do not use Sylence to break the law, to infringe others' rights, or to interfere with Calimero's network or
          other people's use of it.
        </p>
        <h2>Accuracy and experimental features</h2>
        <p>
          Speech recognition and speaker names can be wrong. Smart notes are experimental. Check anything important
          against your own memory of the call before you rely on it.
        </p>
        <h2>Open source and no warranty</h2>
        <p>
          The source code is published on <Ext href={REPO_URL}>GitHub</Ext> under its own license. Sylence is provided
          as is, without warranties of any kind, and to the extent the law allows, Calimero is not liable for any loss
          that comes from using it.
        </p>
        <h2>Changes</h2>
        <p>
          Sylence and these terms may change. The current version is always on this page, with the date it was last
          updated. Questions go to the <Ext href={ISSUES_URL}>Sylence issue tracker</Ext>.
        </p>
      </div>
    </>
  );
}
