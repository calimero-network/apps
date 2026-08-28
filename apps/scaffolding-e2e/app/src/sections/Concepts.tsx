import React from "react";

export function Concepts() {
  return (
    <div style={{ maxWidth: 900, margin: "0 auto" }}>
      <div className="section-header">
        <h2 className="section-title">How Calimero Works</h2>
        <p className="section-desc">
          A comprehensive reference for every concept behind the Calimero
          peer-to-peer application platform. Read this before touching the other
          sections.
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

      <SectionBlock title="Two-Node Testing Guide">
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
          <div style={{ fontSize: 13, fontWeight: 700, color: "#60a5fa" }}>Frontend A</div>
          <div style={{ fontSize: 10, color: "var(--color-text-muted)", fontFamily: "monospace", marginTop: 2 }}>
            ?node=:2528
          </div>
        </div>
        <div style={frontendStyle}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#60a5fa" }}>Frontend B</div>
          <div style={{ fontSize: 10, color: "var(--color-text-muted)", fontFamily: "monospace", marginTop: 2 }}>
            ?node=:2529
          </div>
        </div>
      </div>

      {/* Row 2: Arrows down to nodes */}
      <div style={{ display: "flex", gap: 80, justifyContent: "center", margin: "2px 0" }}>
        <ArchVertArrow label="JSON-RPC / WS" />
        <ArchVertArrow label="JSON-RPC / WS" />
      </div>

      {/* Row 3: Nodes with Context inside */}
      <div style={{ display: "flex", alignItems: "center", gap: 0, justifyContent: "center" }}>
        {/* Node A */}
        <div style={nodeStyle}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "var(--color-brand-600)", letterSpacing: 0.3 }}>
            NODE A
          </div>
          <div style={{ fontSize: 10, color: "var(--color-text-muted)", fontFamily: "monospace", marginTop: -6 }}>
            merod :2528
          </div>
          {/* Context inside Node A */}
          <div style={contextStyle}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--color-brand-600)" }}>Context</div>
            <div style={{ fontSize: 10, color: "var(--color-text-muted)", marginTop: 2 }}>WASM runtime + state</div>
          </div>
          <div style={{ fontSize: 10, color: "var(--color-text-muted)", display: "flex", gap: 8 }}>
            <span>blobs</span>
            <span>·</span>
            <span>private storage</span>
          </div>
        </div>

        {/* CRDT sync arrow between nodes */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3, padding: "0 18px" }}>
          <span style={{ fontSize: 10, fontWeight: 600, color: "var(--color-brand-600)", letterSpacing: 0.3 }}>
            CRDT sync
          </span>
          <span style={{ fontSize: 10, color: "var(--color-text-muted)", fontStyle: "italic" }}>gossipsub P2P</span>
          <span style={{ fontSize: 16, color: "var(--color-brand-600)", letterSpacing: -3 }}>
            &#8592;&#8212;&#8212;&#8194;&#8212;&#8212;&#8594;
          </span>
        </div>

        {/* Node B */}
        <div style={nodeStyle}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "var(--color-brand-600)", letterSpacing: 0.3 }}>
            NODE B
          </div>
          <div style={{ fontSize: 10, color: "var(--color-text-muted)", fontFamily: "monospace", marginTop: -6 }}>
            merod :2529
          </div>
          {/* Context inside Node B */}
          <div style={contextStyle}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--color-brand-600)" }}>Context</div>
            <div style={{ fontSize: 10, color: "var(--color-text-muted)", marginTop: 2 }}>WASM runtime + state</div>
          </div>
          <div style={{ fontSize: 10, color: "var(--color-text-muted)", display: "flex", gap: 8 }}>
            <span>blobs</span>
            <span>·</span>
            <span>private storage</span>
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
        Each node runs its own Context instance locally. CRDT sync merges state
        between nodes automatically — no central server, no conflict resolution needed.
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
    term: "Node",
    tag: "Infrastructure",
    tagColor: "#3b82f6",
    definition:
      "A running merod process. Hosts one or more contexts. Each developer runs their own node locally or on a server. There is no shared infrastructure — every participant owns their node.",
  },
  {
    term: "Context",
    tag: "Core",
    tagColor: "var(--color-brand-600)",
    definition:
      "A live instance of a WASM application. Has its own replicated CRDT state. Multiple nodes join the same context to share state. Identified by a base58 context ID (32-byte Ed25519 public key).",
  },
  {
    term: "Namespace / Group",
    tag: "Membership",
    tagColor: "#8b5cf6",
    definition:
      "Organizational layer above contexts. A namespace owns groups; groups own contexts. Joining a namespace grants eligibility to join any context inside it, removing the need for per-context invitations. Used for access control and discovery.",
  },
  {
    term: "Device / Account",
    tag: "Auth",
    tagColor: "#f59e0b",
    definition:
      "Two different identities, and app code has to know which it holds. A device is one installation: an Ed25519 keypair, shown base58, what a context membership is tied to and what the CRDT layer uses as a replica id — env::device_id(). An account is the person, shown as 64 hex characters, and is the only thing that authorizes anything (the SharedStorage writer set is keyed by it) — env::account_id(). One account can have several devices. env::executor_id() used to be both and no longer exists. Call whoami to see both of yours.",
  },
  {
    term: "CRDT",
    tag: "Sync",
    tagColor: "#06b6d4",
    definition:
      "Conflict-free Replicated Data Type. Data structures that merge automatically when two nodes have concurrent writes. No conflicts, no coordination needed, no central authority. The node daemon handles merge logic transparently.",
  },
  {
    term: "Ephemeral presence",
    tag: "Transient",
    tagColor: "#a855f7",
    definition:
      "Transient state that never persists: cursors, typing indicators, who is online. It gossips node-to-node encrypted, runs NO WASM and adds NOTHING to the DAG, and it expires — the node keeps a 7 second TTL per author. Deliberately not a CRDT: the store is N independent single-writer registers keyed by author, so two authors never merge, they sit side by side. The write/read shape follows from that — mero.ephemeral.set(contextId, state) takes no author because you can only write your own slot (the node resolves it from its owned context identity, so a client cannot publish as someone else), while subscribe(contextId, handler) yields everyone's. Subscribing replays the context's current presence to that connection before any live deltas; a replayed entry carries ageMs and a live one does not, which is how you tell them apart without the two machines agreeing on a clock. Reach for it when the data is worthless a second later — and for anything you would be upset to lose, use a CRDT collection instead.",
  },
  {
    term: "xcall",
    tag: "Cross-Context",
    tagColor: "#ec4899",
    definition:
      "Cross-context call. Lets one context invoke a method on another context, potentially on a different node. Fire-and-forget — the call is queued by the local node and delivered asynchronously. Enables multi-context application workflows.",
  },
  {
    term: "Blob",
    tag: "Files",
    tagColor: "#16a34a",
    definition:
      "A file stored on the node. Identified by its SHA-256 hash (base58 encoded). Metadata (name, size, MIME type) replicates via CRDT to all peers. The blob bytes themselves stay on the originating node until a peer explicitly fetches them (lazy replication).",
  },
  {
    term: "Private Storage",
    tag: "Local Only",
    tagColor: "#ef4444",
    definition:
      "Node-local state marked #[app::private]. Never replicated to any peer. Used for secrets in commit-reveal schemes — e.g., store a secret locally, publish only its hash to the shared CRDT state, then reveal the secret later.",
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
    scope: "Context",
    replicates: "All nodes",
    merge: "Last-Write-Wins",
    useCase: "Shared settings, app state",
  },
  {
    type: "User Storage",
    scope: "Per-identity",
    replicates: "All nodes",
    merge: "LWW per identity",
    useCase: "Per-user preferences",
  },
  {
    type: "Frozen Storage",
    scope: "Context",
    replicates: "All nodes",
    merge: "Immutable (SHA256 key)",
    useCase: "Audit logs, signed content",
  },
  {
    type: "Private Storage",
    scope: "This node only",
    replicates: "Never",
    merge: "N/A",
    useCase: "Secrets, commit-reveal",
  },
  {
    type: "Blob",
    scope: "Node + metadata",
    replicates: "Metadata yes, bytes lazy",
    merge: "Metadata LWW",
    useCase: "File sharing",
  },
  {
    type: "CRDT Counters",
    scope: "Context",
    replicates: "All nodes",
    merge: "G-counter or PN-counter",
    useCase: "Event counts, scores",
  },
  {
    type: "RGA Document",
    scope: "Context",
    replicates: "All nodes",
    merge: "Position-aware merge",
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
    title: "Run the setup script (recommended)",
    body: (
      <>
        <p style={{ margin: "0 0 8px" }}>
          The easiest way to get two nodes running is the bundled{" "}
          <code>setup.sh</code> script. It starts both nodes, authenticates
          them, creates the namespace, installs the app bundle, and wires up
          the context — no browser required.
        </p>
        <CodeBlock>{`./setup.sh`}</CodeBlock>
        <p style={{ margin: "8px 0 0" }}>
          Re-run with <code>--clean</code> to wipe state and start fresh.
          Uses hardcoded credentials (<code>admin</code> /{" "}
          <code>calimero1234</code>) that can be overridden via{" "}
          <code>CALIMERO_ADMIN_USER</code> / <code>CALIMERO_ADMIN_PASS</code>.
          Pass <code>--merobox</code> to use <code>merobox</code> instead of{" "}
          <code>merod</code> for node startup.
        </p>
      </>
    ),
  },
  {
    n: 2,
    title: "Or start nodes manually",
    body: (
      <>
        <p style={{ margin: "0 0 8px" }}>
          If you prefer manual control, run each node in a separate terminal
          using <code>merod</code>:
        </p>
        <CodeBlock>{`merod --home ~/.merod-a --server-port 2428 --swarm-port 2528
merod --home ~/.merod-b --server-port 2429 --swarm-port 2529`}</CodeBlock>
        <p style={{ margin: "8px 0 8px" }}>
          Or use <code>merobox</code> (wraps Docker or runs natively with{" "}
          <code>--no-docker</code>):
        </p>
        <CodeBlock>{`merobox run --no-docker --home ~/.merod-a --server-port 2428 --swarm-port 2528
merobox run --no-docker --home ~/.merod-b --server-port 2429 --swarm-port 2529`}</CodeBlock>
        <p style={{ margin: "8px 0 0" }}>
          Then go through the Setup Wizard in each tab to authenticate,
          create a namespace, install the bundle, and join the context.
        </p>
      </>
    ),
  },
  {
    n: 3,
    title: "Open Tab A — connect to Node A",
    body: (
      <>
        <p style={{ margin: "0 0 8px" }}>
          Open the app in your browser with the node URL for Node A:
        </p>
        <CodeBlock>{`http://localhost:5173?node=http://localhost:2428`}</CodeBlock>
        <p style={{ margin: "8px 0 0" }}>
          Authenticate and create or select a context. You can also use the{" "}
          <strong>+ Open Node B tab</strong> button in the top bar to open a
          pre-filled second tab automatically.
        </p>
      </>
    ),
  },
  {
    n: 4,
    title: "Open Tab B — connect to Node B",
    body: (
      <>
        <p style={{ margin: "0 0 8px" }}>
          Open a second tab pointing at Node B:
        </p>
        <CodeBlock>{`http://localhost:5173?node=http://localhost:2429`}</CodeBlock>
        <p style={{ margin: "8px 0 0" }}>Authenticate as a different identity.</p>
      </>
    ),
  },
  {
    n: 5,
    title: "Join the same context (if not already done by setup.sh)",
    body: (
      <>
        <p style={{ margin: "0 0 8px" }}>
          If you ran <code>setup.sh</code> this is already done — skip ahead.
          For manual setup:
        </p>
        <p style={{ margin: "0 0 8px" }}>
          On Tab A: go to Setup Wizard → Generate Invitation → copy the
          payload.
        </p>
        <p style={{ margin: "0 0 8px" }}>
          On Tab B: Setup Wizard → Join Context → paste the payload.
        </p>
        <p style={{ margin: 0 }}>
          Both tabs now share the same context ID and state root.
        </p>
      </>
    ),
  },
  {
    n: 6,
    title: "Test cross-node sync",
    body: (
      <p style={{ margin: 0 }}>
        Go to KV Operations on Tab A and set a key. Switch to Tab B and
        click Refresh — the value appears within 1–3 seconds. This is CRDT
        gossipsub replication in action.
      </p>
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
        The most important test you can run: two nodes, one context, watching
        state propagate. The fastest path is <code>./setup.sh</code> which
        handles everything automatically — or follow the manual steps below.
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
    label: "Context ID",
    encoding: "base58",
    size: "32 bytes",
    description: "Identifies a context instance. Derived from the context's Ed25519 public key.",
  },
  {
    label: "Device Key",
    encoding: "base58",
    size: "32 bytes",
    description:
      "Ed25519 public key identifying one installation, and what the CRDT layer uses as the replica id. Never an authorization subject — that is the account. NOT sent with a call: it used to travel as executorPublicKey, but the node reads the caller from the bearer token and ignores anything passed alongside, so this app does not send it (see the assertion in api/rpc.test.ts).",
  },
  {
    label: "Account ID",
    encoding: "hex",
    size: "32 bytes",
    description:
      "Identifies a person, and is the only thing that authorizes anything: writer sets, entry ownership and group membership are all keyed by it. One account can hold several device keys. Rendered hex, deliberately unlike a key, so the two are never pasted interchangeably.",
  },
  {
    label: "Group ID",
    encoding: "hex",
    size: "variable",
    description: "Identifies a namespace group. Used in invitation and membership management.",
  },
  {
    label: "Blob ID",
    encoding: "base58",
    size: "32 bytes",
    description: "SHA-256 hash of the blob content. Content-addressed — the same file always has the same ID.",
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
