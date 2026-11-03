import React from "react";

export function Concepts() {
  return (
    <div style={{ maxWidth: 900, margin: "0 auto" }}>
      <div className="section-header">
        <h2 className="section-title">How Calimero Works</h2>
        <p className="section-desc">
          A reference for every concept behind Calimero 1.0 as this bench uses
          it: accounts, organizations, app instances and the log that orders
          every write. Read this before touching the other sections.
        </p>
      </div>

      <SectionBlock title="Architecture">
        <ArchDiagram />
      </SectionBlock>

      <SectionBlock title="Core Concepts Glossary">
        <GlossaryList />
      </SectionBlock>

      <SectionBlock title="Storage Types">
        <StorageTable />
      </SectionBlock>

      <SectionBlock title="Two-Account Testing Guide">
        <TwoNodeGuide />
      </SectionBlock>

      <SectionBlock title="ID Format Reference">
        <IdFormats />
      </SectionBlock>
    </div>
  );
}

function SectionBlock({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ marginBottom: 40 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginBottom: 16,
        }}
      >
        <div
          style={{
            width: 3,
            height: 18,
            borderRadius: 2,
            background: "var(--color-brand-600)",
            flexShrink: 0,
          }}
        />
        <h3
          style={{
            fontSize: 13,
            fontWeight: 700,
            color: "var(--color-text-primary)",
            textTransform: "uppercase",
            letterSpacing: 1.2,
            margin: 0,
          }}
        >
          {title}
        </h3>
      </div>
      {children}
    </div>
  );
}

function ArchDiagram() {
  const nodeStyle: React.CSSProperties = {
    border: "1.5px solid var(--color-brand-600)",
    borderRadius: 10,
    background: "rgba(165,255,17,0.05)",
    padding: "14px 16px 16px",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 10,
    minWidth: 190,
  };

  const contextStyle: React.CSSProperties = {
    border: "1.5px dashed var(--color-brand-600)",
    borderRadius: 7,
    background: "rgba(165,255,17,0.08)",
    padding: "8px 18px",
    textAlign: "center",
    width: "100%",
  };

  const frontendStyle: React.CSSProperties = {
    border: "1.5px solid #3b82f6",
    borderRadius: 8,
    background: "rgba(59,130,246,0.08)",
    padding: "8px 16px",
    textAlign: "center",
    minWidth: 190,
  };

  return (
    <div
      style={{
        background: "var(--color-bg-card)",
        border: "1px solid var(--color-border)",
        borderRadius: 12,
        padding: "28px 24px 24px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 0,
      }}
    >
      {/* Row 1: Frontends */}
      <div style={{ display: "flex", gap: 80, justifyContent: "center" }}>
        <div style={frontendStyle}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#60a5fa" }}>Account A</div>
          <div style={{ fontSize: 10, color: "var(--color-text-muted)", fontFamily: "monospace", marginTop: 2 }}>
            passkey · browser profile 1
          </div>
        </div>
        <div style={frontendStyle}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#60a5fa" }}>Account B</div>
          <div style={{ fontSize: 10, color: "var(--color-text-muted)", fontFamily: "monospace", marginTop: 2 }}>
            passkey · browser profile 2
          </div>
        </div>
      </div>

      {/* Row 2: Arrows down to nodes */}
      <div style={{ display: "flex", gap: 80, justifyContent: "center", margin: "2px 0" }}>
        <ArchVertArrow label="CalimeroClient · HTTPS" />
        <ArchVertArrow label="CalimeroClient · HTTPS" />
      </div>

      {/* Row 3: Nodes with Context inside */}
      <div style={{ display: "flex", alignItems: "center", gap: 0, justifyContent: "center" }}>
        {/* The leader */}
        <div style={nodeStyle}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "var(--color-brand-600)", letterSpacing: 0.3 }}>
            LEADER
          </div>
          <div style={{ fontSize: 10, color: "var(--color-text-muted)", fontFamily: "monospace", marginTop: -6 }}>
            merod local :2501
          </div>
          {/* The instance on the leader */}
          <div style={contextStyle}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--color-brand-600)" }}>App instance</div>
            <div style={{ fontSize: 10, color: "var(--color-text-muted)", marginTop: 2 }}>component + state</div>
          </div>
          <div style={{ fontSize: 10, color: "var(--color-text-muted)", display: "flex", gap: 8 }}>
            <span>blobs</span>
            <span>·</span>
            <span>presence</span>
          </div>
        </div>

        {/* CRDT sync arrow between nodes */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3, padding: "0 18px" }}>
          <span style={{ fontSize: 10, fontWeight: 600, color: "var(--color-brand-600)", letterSpacing: 0.3 }}>
            one log
          </span>
          <span style={{ fontSize: 10, color: "var(--color-text-muted)", fontStyle: "italic" }}>replicated, leader-ordered</span>
          <span style={{ fontSize: 16, color: "var(--color-brand-600)", letterSpacing: -3 }}>
            &#8592;&#8212;&#8212;&#8194;&#8212;&#8212;&#8594;
          </span>
        </div>

        {/* A follower */}
        <div style={nodeStyle}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "var(--color-brand-600)", letterSpacing: 0.3 }}>
            FOLLOWER
          </div>
          <div style={{ fontSize: 10, color: "var(--color-text-muted)", fontFamily: "monospace", marginTop: -6 }}>
            merod local :2502
          </div>
          {/* The instance on a follower */}
          <div style={contextStyle}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--color-brand-600)" }}>App instance</div>
            <div style={{ fontSize: 10, color: "var(--color-text-muted)", marginTop: 2 }}>component + state</div>
          </div>
          <div style={{ fontSize: 10, color: "var(--color-text-muted)", display: "flex", gap: 8 }}>
            <span>blobs</span>
            <span>·</span>
            <span>presence</span>
          </div>
        </div>
      </div>

      {/* Footer note */}
      <div
        style={{
          marginTop: 18,
          padding: "8px 14px",
          background: "rgba(165,255,17,0.04)",
          border: "1px solid rgba(165,255,17,0.15)",
          borderRadius: 6,
          fontSize: 11,
          color: "var(--color-text-muted)",
          maxWidth: 560,
          textAlign: "center",
          lineHeight: 1.6,
        }}
      >
        The leader runs every call and appends it to the app&apos;s log; the other
        nodes apply the same log. A write is visible to every account at once, and
        a later write simply replaces an earlier one: there is nothing to merge.
      </div>
    </div>
  );
}

function ArchVertArrow({ label }: { label: string }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 0,
        minWidth: 160,
        padding: "2px 0",
      }}
    >
      {label && (
        <span
          style={{
            fontSize: 10,
            color: "var(--color-text-muted)",
            fontStyle: "italic",
            marginBottom: 0,
          }}
        >
          {label}
        </span>
      )}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          color: "var(--color-brand-600)",
          lineHeight: 1,
          fontSize: 14,
        }}
      >
        <span>&#8597;</span>
      </div>
    </div>
  );
}

const GLOSSARY_ITEMS: {
  term: string;
  tag: string;
  tagColor: string;
  definition: string;
}[] = [
  {
    term: "Cluster / node",
    tag: "Infrastructure",
    tagColor: "#3b82f6",
    definition:
      "A set of merod nodes that serve apps together: `merod local` runs three in one process (127.0.0.1:2501-2503) for development, Calimero Cloud runs attested ones in production. The client fails over between them; you never pick one.",
  },
  {
    term: "Account / passkey",
    tag: "Auth",
    tagColor: "#f59e0b",
    definition:
      "You are an account, and your passkey is how you sign in: client.signUp / signIn. A method runs FOR the account (env::caller()), which is the only authorization subject here: writer sets, owners, roles and per-user storage are all keyed by it. There is no separate device id in an app run — whoami answers the account twice.",
  },
  {
    term: "Organization",
    tag: "Membership",
    tagColor: "#8b5cf6",
    definition:
      "Who reaches an app instance: its owner, admins, members and guests (v1's namespace). An invitation is an org invite, approved with the inviter's passkey and redeemed after sign-in. Anyone outside the org is refused (404) before the app runs; an anonymous caller gets 401.",
  },
  {
    term: "App instance",
    tag: "Core",
    tagColor: "var(--color-brand-600)",
    definition:
      "A live instance of the app (v1's context), created from the dev bundle (merod local) or the published package (production), privately or in an org. Every section here calls one instance: client.call(app, method, args) for a logged call, client.view(...) for a read.",
  },
  {
    term: "The log",
    tag: "Ordering",
    tagColor: "#06b6d4",
    definition:
      "The cluster's leader runs each call and appends it to the instance's replicated log, so every write has one order and every node applies the same one. v1's CRDTs existed to merge concurrent writes made on different nodes; with one order there is nothing to merge, so the collections here are plain data structures (a later write replaces an earlier one). Text stays a sequence CRDT (Fugue) because editors send edits typed against a stale view.",
  },
  {
    term: "Ephemeral presence",
    tag: "Transient",
    tagColor: "#a855f7",
    definition:
      "Transient state that never persists: cursors, typing indicators, who is online. The node keeps it in memory per instance; it runs no app code and adds nothing to the log. Deliberately not a CRDT: N single-writer slots keyed by author. publishPresence(app, seq, state) takes no author — you can only write your own slot — while presenceStream(app) yields everyone's, a snapshot first and then each change.",
  },
  {
    term: "xcall",
    tag: "Cross-App",
    tagColor: "#ec4899",
    definition:
      "A call from one app instance to another. Core 1.0.0-rc.7 components can RECEIVE a call from another app (a method marked allow(app = ...), which sees Caller::App) but cannot send one, so ws_ping_channel records the ping and sends nothing.",
  },
  {
    term: "Blob",
    tag: "Files",
    tagColor: "#16a34a",
    definition:
      "A file in an instance's blob store, uploaded with client.uploadBlob(app, bytes) and served by every node of the cluster. The contract keeps a record of it (name, size, MIME type, blob id). At core 1.0.0-rc.7 a contract cannot read the bytes itself.",
  },
  {
    term: "Secrets game",
    tag: "Per account",
    tagColor: "#ef4444",
    definition:
      "v1 kept the secret node-local (#[app::private]), which 1.0 has no equivalent of. Here the secret is the setter's own entry in the app's state, which only my_secrets of the same account returns, and only its SHA-256 is public. It is hidden from other accounts by the methods, not from the node operator.",
  },
];

function GlossaryList() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {GLOSSARY_ITEMS.map((item) => (
        <div
          key={item.term}
          style={{
            background: "var(--color-bg-card)",
            border: "1px solid var(--color-border)",
            borderRadius: 8,
            padding: "14px 16px",
            display: "flex",
            gap: 14,
            alignItems: "flex-start",
          }}
        >
          <div
            style={{
              minWidth: 8,
              height: 8,
              borderRadius: "50%",
              background: item.tagColor,
              marginTop: 5,
              flexShrink: 0,
            }}
          />
          <div style={{ flex: 1 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                marginBottom: 4,
                flexWrap: "wrap",
              }}
            >
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  color: "var(--color-text-primary)",
                }}
              >
                {item.term}
              </span>
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  padding: "1px 7px",
                  borderRadius: 4,
                  background: `${item.tagColor}22`,
                  color: item.tagColor,
                  border: `1px solid ${item.tagColor}55`,
                }}
              >
                {item.tag}
              </span>
            </div>
            <p
              style={{
                fontSize: 12,
                color: "var(--color-text-muted)",
                lineHeight: 1.65,
                margin: 0,
              }}
            >
              {item.definition}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

const STORAGE_ROWS: {
  type: string;
  scope: string;
  replicates: string;
  merge: string;
  useCase: string;
}[] = [
  {
    type: "KV Store",
    scope: "Instance",
    replicates: "All nodes",
    merge: "Later write wins (one log)",
    useCase: "Shared settings, app state",
  },
  {
    type: "User Storage",
    scope: "Per account",
    replicates: "All nodes",
    merge: "Only the account writes its own",
    useCase: "Per-user preferences",
  },
  {
    type: "Frozen Storage",
    scope: "Instance",
    replicates: "All nodes",
    merge: "Immutable (SHA-256 address)",
    useCase: "Audit logs, signed content",
  },
  {
    type: "Secrets",
    scope: "Per account",
    replicates: "All nodes",
    merge: "Read back only by its setter",
    useCase: "Commit-reveal",
  },
  {
    type: "Blob",
    scope: "Instance blob store + record",
    replicates: "Record yes, bytes served by the cluster",
    merge: "Record replaced as a whole",
    useCase: "File sharing",
  },
  {
    type: "Counters",
    scope: "Instance",
    replicates: "All nodes",
    merge: "Every increment counts (one log)",
    useCase: "Event counts, scores",
  },
  {
    type: "Text document",
    scope: "Instance",
    replicates: "All nodes",
    merge: "Fugue: edits land where sent",
    useCase: "Collaborative text",
  },
];

function StorageTable() {
  const headers = ["Type", "Scope", "Replicates?", "Merge rule", "Use case"];

  return (
    <div
      style={{
        background: "var(--color-bg-card)",
        border: "1px solid var(--color-border)",
        borderRadius: 10,
        overflow: "hidden",
      }}
    >
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          fontSize: 12,
        }}
      >
        <thead>
          <tr
            style={{
              background: "rgba(165,255,17,0.06)",
              borderBottom: "1px solid var(--color-border)",
            }}
          >
            {headers.map((h) => (
              <th
                key={h}
                style={{
                  padding: "10px 14px",
                  textAlign: "left",
                  fontSize: 11,
                  fontWeight: 700,
                  color: "var(--color-brand-600)",
                  textTransform: "uppercase",
                  letterSpacing: 0.8,
                  whiteSpace: "nowrap",
                }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {STORAGE_ROWS.map((row, i) => (
            <tr
              key={row.type}
              style={{
                background:
                  i % 2 === 0
                    ? "transparent"
                    : "rgba(255,255,255,0.02)",
                borderBottom:
                  i < STORAGE_ROWS.length - 1
                    ? "1px solid var(--color-border)"
                    : "none",
              }}
            >
              <td
                style={{
                  padding: "10px 14px",
                  fontWeight: 600,
                  color: "var(--color-text-primary)",
                  whiteSpace: "nowrap",
                }}
              >
                {row.type}
              </td>
              <td
                style={{
                  padding: "10px 14px",
                  color: "var(--color-text-muted)",
                  whiteSpace: "nowrap",
                }}
              >
                {row.scope}
              </td>
              <td style={{ padding: "10px 14px", whiteSpace: "nowrap" }}>
                <ReplicatesCell value={row.replicates} />
              </td>
              <td
                style={{
                  padding: "10px 14px",
                  color: "var(--color-text-muted)",
                  fontFamily: "Courier New, monospace",
                  fontSize: 11,
                }}
              >
                {row.merge}
              </td>
              <td
                style={{
                  padding: "10px 14px",
                  color: "var(--color-text-muted)",
                }}
              >
                {row.useCase}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ReplicatesCell({ value }: { value: string }) {
  const isNever = value === "Never";
  const isLazy = value.includes("lazy");
  const color = isNever ? "#ef4444" : isLazy ? "#f59e0b" : "#16a34a";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        color,
        fontWeight: 600,
      }}
    >
      <span>{isNever ? "✗" : "✓"}</span>
      <span
        style={{
          fontWeight: 400,
          color: "var(--color-text-muted)",
          fontSize: 11,
        }}
      >
        {value === "All nodes" ? "All nodes" : value === "Never" ? "" : value}
      </span>
    </span>
  );
}

const TWO_NODE_STEPS: {
  n: number;
  title: string;
  body: React.ReactNode;
}[] = [
  {
    n: 1,
    title: "Start merod local and this app",
    body: (
      <>
        <p style={{ margin: "0 0 8px" }}>
          One command starts the cluster (three nodes in one process), builds and
          uploads the component, and runs this frontend on{" "}
          <code>http://localhost:5173</code>:
        </p>
        <CodeBlock>{`pnpm dev:local scaffolding-e2e`}</CodeBlock>
        <p style={{ margin: "8px 0 0" }}>
          <code>merod local</code> is Linux-only at core 1.0.0-rc.7. Its state is
          kept in <code>.merod-local/</code>; <code>--fresh</code> starts over.
        </p>
      </>
    ),
  },
  {
    n: 2,
    title: "Account A: sign up and create a shared instance",
    body: (
      <p style={{ margin: 0 }}>
        Sign up with a passkey, then create an instance with &ldquo;shared&rdquo;
        ticked: it gets an organization of its own. Claim the workspace in Setup.
      </p>
    ),
  },
  {
    n: 3,
    title: "Invite account B",
    body: (
      <p style={{ margin: 0 }}>
        In Setup, create an invitation link (your passkey approves it) and open it
        in a second browser profile, where account B signs up. The invitation is
        redeemed after sign-in and the instance appears in B&apos;s list.
      </p>
    ),
  },
  {
    n: 4,
    title: "Watch writes arrive",
    body: (
      <p style={{ margin: 0 }}>
        Set a key as A and read it as B: the write is in the log, so B reads it at
        once. Try the rules too: B cannot write the shared or owned cell until A
        grants it, and every refusal answers <code>Forbidden</code>.
      </p>
    ),
  },
  {
    n: 5,
    title: "Run the automated suites",
    body: (
      <>
        <p style={{ margin: "0 0 8px" }}>
          &ldquo;Run All Tests&rdquo; runs the in-app suite against the open
          instance. The contract&apos;s scenarios run as real accounts on the
          cluster with:
        </p>
        <CodeBlock>{`pnpm merod-local e2e scaffolding-e2e`}</CodeBlock>
      </>
    ),
  },
];

function TwoNodeGuide() {
  return (
    <div
      style={{
        background: "var(--color-bg-card)",
        border: "1px solid var(--color-border)",
        borderRadius: 10,
        padding: "24px 20px",
      }}
    >
      <p
        style={{
          fontSize: 12,
          color: "var(--color-text-muted)",
          marginBottom: 24,
          lineHeight: 1.65,
        }}
      >
        The most important test you can run: two accounts, one instance, each
        on whichever node the client picked, watching every write arrive.
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
        {TWO_NODE_STEPS.map((step, i) => (
          <div
            key={step.n}
            style={{ display: "flex", gap: 16, position: "relative" }}
          >
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                flexShrink: 0,
              }}
            >
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: "50%",
                  background: "var(--color-brand-600)",
                  color: "#000",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 13,
                  fontWeight: 700,
                  flexShrink: 0,
                  zIndex: 1,
                }}
              >
                {step.n}
              </div>
              {i < TWO_NODE_STEPS.length - 1 && (
                <div
                  style={{
                    width: 1,
                    flex: 1,
                    background: "var(--color-border)",
                    minHeight: 20,
                  }}
                />
              )}
            </div>
            <div
              style={{
                flex: 1,
                paddingBottom: i < TWO_NODE_STEPS.length - 1 ? 24 : 0,
              }}
            >
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: "var(--color-text-primary)",
                  marginBottom: 8,
                  paddingTop: 5,
                }}
              >
                {step.title}
              </div>
              <div
                style={{
                  fontSize: 12,
                  color: "var(--color-text-muted)",
                  lineHeight: 1.65,
                }}
              >
                {step.body}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const ID_FORMATS: {
  label: string;
  encoding: string;
  size: string;
  description: string;
}[] = [
  {
    label: "Instance ID",
    encoding: "opaque string",
    size: "—",
    description: "Identifies an app instance (v1's context id). client.listApps() lists the ones your account reaches; the context bar copies the open one.",
  },
  {
    label: "Account ID",
    encoding: "opaque string",
    size: "—",
    description:
      "Identifies a person, and is the only thing that authorizes anything: writer sets, owners, roles and per-user storage are keyed by it. whoami (or the bottom of the sidebar) tells you yours.",
  },
  {
    label: "Organization ID",
    encoding: "opaque string",
    size: "—",
    description: "Identifies the organization a shared instance lives in. Invitations are made into it.",
  },
  {
    label: "Blob ID",
    encoding: "hex",
    size: "32 bytes",
    description: "SHA-256 of the blob's content, 64 hex characters. Content-addressed — the same file always has the same id.",
  },
  {
    label: "Frozen hash",
    encoding: "hex",
    size: "32 bytes",
    description: "SHA-256 of the stored (CBOR) value: the address add_frozen returns. Not the SHA-256 of the raw string, as it was in v1.",
  },
  {
    label: "64-bit integers",
    encoding: "decimal string",
    size: "—",
    description: "A u64/i64 travels as a decimal string (\"3\"), so it never loses precision in JSON. This frontend's adapter turns them back into numbers.",
  },
];

function IdFormats() {
  return (
    <div
      style={{
        background: "var(--color-bg-card)",
        border: "1px solid var(--color-border)",
        borderRadius: 10,
        padding: "20px",
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
        gap: 12,
      }}
    >
      {ID_FORMATS.map((f) => (
        <div
          key={f.label}
          style={{
            border: "1px solid var(--color-border)",
            borderRadius: 8,
            padding: "12px 14px",
            background: "rgba(165,255,17,0.03)",
          }}
        >
          <div
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: "var(--color-text-primary)",
              marginBottom: 6,
            }}
          >
            {f.label}
          </div>
          <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
            <span
              style={{
                fontSize: 10,
                fontWeight: 600,
                padding: "1px 6px",
                borderRadius: 4,
                background: "rgba(165,255,17,0.12)",
                color: "var(--color-brand-600)",
                border: "1px solid rgba(165,255,17,0.3)",
                fontFamily: "Courier New, monospace",
              }}
            >
              {f.encoding}
            </span>
            <span
              style={{
                fontSize: 10,
                fontWeight: 600,
                padding: "1px 6px",
                borderRadius: 4,
                background: "rgba(59,130,246,0.1)",
                color: "#60a5fa",
                border: "1px solid rgba(59,130,246,0.3)",
                fontFamily: "Courier New, monospace",
              }}
            >
              {f.size}
            </span>
          </div>
          <p
            style={{
              fontSize: 11,
              color: "var(--color-text-muted)",
              lineHeight: 1.55,
              margin: 0,
            }}
          >
            {f.description}
          </p>
        </div>
      ))}
    </div>
  );
}

function CodeBlock({ children }: { children: string }) {
  return (
    <pre
      style={{
        background: "#0d1117",
        border: "1px solid var(--color-border)",
        borderRadius: 6,
        padding: "9px 13px",
        fontFamily: "Courier New, monospace",
        fontSize: 11,
        color: "#a8d5a2",
        margin: 0,
        overflowX: "auto",
        whiteSpace: "pre",
        lineHeight: 1.6,
      }}
    >
      {children}
    </pre>
  );
}
