export function Concepts() {
  return (
    <div>
      <div className="section-header">
        <h2 className="section-title">How Calimero Works</h2>
        <p className="section-desc">
          Plain-language explanations of the core concepts behind every feature
          in this test suite.
        </p>
      </div>

      {/* ── Fundamentals ──────────────────────────────── */}
      <ConceptGroup title="The Fundamentals">
        <ConceptCard
          icon="🖥"
          title="Node"
          tag="Infrastructure"
          tagColor="blue"
          summary="Your own server. Runs your app logic and holds your data."
        >
          <p>
            A <strong>node</strong> is a running instance of{" "}
            <code>merod</code> (the Calimero daemon). Think of it like your own
            private server — it stores data, executes app logic, and
            communicates with peers.
          </p>
          <p>
            There's no central server. Each participant runs their own node.
            Data is replicated peer-to-peer between nodes that share the same
            context.
          </p>
          <KeyFact>
            The <code>node_url</code> you see in the top bar is the address of
            the node this app is connected to.
          </KeyFact>
        </ConceptCard>

        <ConceptCard
          icon="🚪"
          title="Context"
          tag="Core"
          tagColor="green"
          summary="A shared workspace. Think of it as a room — all members see the same state."
        >
          <p>
            A <strong>context</strong> is a running instance of an application
            with its own isolated state. It's identified by a{" "}
            <code>context_id</code> (a public key).
          </p>
          <p>
            All members of a context automatically receive every state change in
            real time. When you call <code>set("key", "value")</code> on
            node-1, node-2 will see that value shortly after — no server
            required.
          </p>
          <KeyFact>
            Every RPC call you make in this test suite targets a specific
            context. The context ID is shown in the top bar.
          </KeyFact>
        </ConceptCard>

        <ConceptCard
          icon="👥"
          title="Namespace / Group"
          tag="Membership"
          tagColor="purple"
          summary="A team. Contains multiple contexts and one shared member list."
        >
          <p>
            A <strong>namespace</strong> (also called a group) is a collection
            of contexts that share the same membership list. Join the namespace
            once → you're automatically eligible to join any context inside it.
          </p>
          <Hierarchy
            items={[
              {
                label: "Namespace (team)",
                children: [
                  "Context A — chat room",
                  "Context B — shared notes",
                  "Context C — task list",
                ],
              },
            ]}
          />
          <KeyFact>
            Without a namespace, each context requires its own separate
            invitation. With a namespace, one invite covers all contexts inside
            it.
          </KeyFact>
        </ConceptCard>

        <ConceptCard
          icon="🔑"
          title="Identity / Member"
          tag="Auth"
          tagColor="yellow"
          summary="Who you are. Every participant is a public key."
        >
          <p>
            There are no usernames or passwords. Every participant is identified
            by an <strong>ed25519 public key</strong> (shown as a base58
            string). This key signs every action you take.
          </p>
          <p>
            Inside an app, <code>env::executor_id()</code> returns the public
            key of whoever called the method. This is how{" "}
            <strong>User Storage</strong> works — each user's data is stored
            under their own key, unreachable by others.
          </p>
          <KeyFact>
            The <em>executor public key</em> is automatically included in every
            RPC call the Calimero client makes on your behalf.
          </KeyFact>
        </ConceptCard>
      </ConceptGroup>

      {/* ── Invitation Flow ──────────────────────────── */}
      <ConceptGroup title="How to Invite Someone (meroctl)">
        <div
          style={{
            gridColumn: "1 / -1",
            background: "var(--color-bg-card)",
            border: "1px solid var(--color-border)",
            borderRadius: 10,
            padding: 20,
          }}
        >
          <p
            style={{
              fontSize: 13,
              color: "var(--color-text-muted)",
              marginBottom: 20,
            }}
          >
            Invitations are managed at the infrastructure level via the{" "}
            <code>meroctl</code> CLI — not through app code. Here's the exact
            sequence:
          </p>
          <div className="invite-steps">
            <Step n={1} actor="Alice (owner)">
              Install the app and create a namespace:
              <CodeBlock>{`meroctl app install --path e2e_kv_store.wasm
meroctl namespace create --app-id <APP_ID>`}</CodeBlock>
              <Aside>
                This creates a group and gives you a <code>namespace_id</code>.
              </Aside>
            </Step>

            <Step n={2} actor="Alice (owner)">
              Create contexts inside the namespace:
              <CodeBlock>{`meroctl context create --app-id <APP_ID> --group-id <NAMESPACE_ID>`}</CodeBlock>
              <Aside>Returns a <code>context_id</code>.</Aside>
            </Step>

            <Step n={3} actor="Alice (owner)">
              Generate an invitation token:
              <CodeBlock>{`meroctl namespace invite --namespace-id <NAMESPACE_ID>`}</CodeBlock>
              <Aside>
                Returns a one-time <code>invitation</code> token. Share it
                out-of-band (message, QR code, etc).
              </Aside>
            </Step>

            <Step n={4} actor="Bob (new member)">
              Join the namespace using the invitation:
              <CodeBlock>{`meroctl namespace join \\
  --namespace-id <NAMESPACE_ID> \\
  --invitation <INVITATION_TOKEN>`}</CodeBlock>
              <Aside>
                Bob is now a member. He gets a <code>memberIdentity</code>{" "}
                (his public key in this namespace).
              </Aside>
            </Step>

            <Step n={5} actor="Bob (new member)">
              Join a specific context (no extra invitation needed):
              <CodeBlock>{`meroctl context join --context-id <CONTEXT_ID>`}</CodeBlock>
              <Aside>
                Because Bob is in the namespace, he can join any context inside
                it directly. State starts syncing immediately.
              </Aside>
            </Step>

            <Step n={6} actor="Both">
              From this point on, both nodes are peers. Any write on Alice's
              node syncs to Bob's, and vice versa. The app is live.
              <Aside>No central server involved at any step.</Aside>
            </Step>
          </div>
        </div>
      </ConceptGroup>

      {/* ── State Types ──────────────────────────────── */}
      <ConceptGroup title="State Types — What Gets Replicated?">
        <StateTypeCard
          icon="🌐"
          title="Public State (CRDT)"
          color="green"
          replicated
          examples="KV store, counters, registers, tags, RGA document"
        >
          Stored in CRDT collections. Every write is replicated to all context
          members automatically. Concurrent writes from different nodes are
          merged without conflicts using mathematical rules (CRDTs).
        </StateTypeCard>

        <StateTypeCard
          icon="👤"
          title="User Storage"
          color="blue"
          replicated
          examples="set_user_simple, set_user_nested"
        >
          Still replicated across all nodes, but logically partitioned by
          identity. Alice can only write to Alice's slot; Bob can only write to
          Bob's slot. Anyone can <em>read</em> another user's slot if they know
          the public key.
        </StateTypeCard>

        <StateTypeCard
          icon="🧊"
          title="Frozen Storage"
          color="cyan"
          replicated
          examples="add_frozen, get_frozen"
        >
          Content-addressed immutable storage. Once a value is stored, it
          cannot be changed — only retrieved by its SHA256 hash. Replicated
          across peers. Perfect for anchoring versioned data.
        </StateTypeCard>

        <StateTypeCard
          icon="🔒"
          title="Private State"
          color="red"
          replicated={false}
          examples="add_secret, my_secrets"
        >
          Stored with <code>#[app::private]</code>. Exists only on the local
          node — never sent to peers. Used for secrets that should stay local
          (e.g., a game secret before reveal). The public hash can be replicated
          while the secret stays private.
        </StateTypeCard>
      </ConceptGroup>

      {/* ── Permissions ──────────────────────────────── */}
      <ConceptGroup title="Permissions & Access Control">
        <div
          style={{
            gridColumn: "1 / -1",
            background: "var(--color-bg-card)",
            border: "1px solid var(--color-border)",
            borderRadius: 10,
            padding: 20,
          }}
        >
          <p style={{ fontSize: 13, color: "var(--color-text-muted)", marginBottom: 16 }}>
            Calimero uses two layers of access control:
          </p>

          <div className="method-grid" style={{ gap: 12 }}>
            <div className="method-card">
              <div
                className="method-name"
                style={{ color: "var(--color-brand-600)" }}
              >
                Infrastructure level (meroctl)
              </div>
              <p style={{ fontSize: 12, color: "var(--color-text-muted)", marginBottom: 8 }}>
                Controls who can <em>join</em> a namespace or context.
                Enforced by the node daemon before any app code runs.
              </p>
              <ul style={{ fontSize: 12, color: "var(--color-text-muted)", paddingLeft: 16 }}>
                <li>
                  <strong>Namespace member</strong> — can join any context in
                  the namespace
                </li>
                <li>
                  <strong>Context member</strong> — can execute app methods in
                  a specific context
                </li>
                <li>Non-members are rejected before reaching the app</li>
              </ul>
            </div>

            <div className="method-card">
              <div
                className="method-name"
                style={{ color: "var(--color-brand-600)" }}
              >
                Application level (app code)
              </div>
              <p style={{ fontSize: 12, color: "var(--color-text-muted)", marginBottom: 8 }}>
                Fine-grained logic inside your WASM app. Controls what members
                can <em>do</em> once they're inside a context.
              </p>
              <ul style={{ fontSize: 12, color: "var(--color-text-muted)", paddingLeft: 16 }}>
                <li>
                  Use <code>env::executor_id()</code> to know who's calling
                </li>
                <li>
                  Programmatically <code>add_member</code> /{" "}
                  <code>kick_member</code> via the access-control API
                </li>
                <li>
                  Store per-user data in <code>UserStorage</code> so only the
                  owner can write
                </li>
                <li>
                  Keep node-local secrets via <code>#[app::private]</code>
                </li>
              </ul>
            </div>

            <div className="method-card">
              <div
                className="method-name"
                style={{ color: "var(--color-brand-600)" }}
              >
                Capability: <code>member</code>
              </div>
              <p style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
                When creating a mesh or inviting someone, you assign a
                capability. Currently <code>member</code> is the primary role —
                it grants full read/write access to the context. More granular
                roles (admin, observer) are planned.
              </p>
            </div>
          </div>
        </div>
      </ConceptGroup>

      {/* ── Cross-Context Calls ─────────────────────── */}
      <ConceptGroup title="Cross-Context Calls (XCall)">
        <div
          style={{
            gridColumn: "1 / -1",
            background: "var(--color-bg-card)",
            border: "1px solid var(--color-border)",
            borderRadius: 10,
            padding: 20,
          }}
        >
          <p style={{ fontSize: 13, color: "var(--color-text-muted)", marginBottom: 12 }}>
            An app running in Context A can call a method in Context B. This is
            how you build multi-context workflows — e.g., a task-list app
            calling a payments app.
          </p>
          <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 12 }}>
            <div
              style={{
                background: "rgba(165,255,17,0.1)",
                border: "1px solid var(--color-brand-700)",
                borderRadius: 8,
                padding: "8px 14px",
                fontSize: 12,
                color: "var(--color-brand-600)",
              }}
            >
              Context A (caller)
            </div>
            <span style={{ color: "var(--color-brand-600)", fontSize: 18 }}>→</span>
            <div
              style={{
                background: "rgba(59,130,246,0.1)",
                border: "1px solid #3b82f6",
                borderRadius: 8,
                padding: "8px 14px",
                fontSize: 12,
                color: "#60a5fa",
              }}
            >
              Context B (callee)
            </div>
          </div>
          <p style={{ fontSize: 12, color: "var(--color-text-muted)", marginBottom: 8 }}>
            The <strong>access-control</strong> app demonstrates this with:
          </p>
          <ul style={{ fontSize: 12, color: "var(--color-text-muted)", paddingLeft: 16 }}>
            <li>
              <code>create_context_child(protocol, app_id, alias)</code> —
              creates a new child context from within the app
            </li>
            <li>
              <code>get_child_id(alias)</code> — resolves the child context ID
            </li>
            <li>
              <code>delete_context_child(context_id)</code> — removes the child
            </li>
          </ul>
          <p style={{ fontSize: 12, color: "var(--color-text-muted)", marginTop: 8 }}>
            XCall is tested separately in <code>core/apps/xcall-example</code>.
          </p>
        </div>
      </ConceptGroup>
    </div>
  );
}

/* ── Sub-components ──────────────────────────────────────────────── */

function ConceptGroup({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ marginBottom: 32 }}>
      <h3
        style={{
          fontSize: 13,
          fontWeight: 600,
          color: "var(--color-text-muted)",
          textTransform: "uppercase",
          letterSpacing: 1,
          marginBottom: 12,
        }}
      >
        {title}
      </h3>
      <div className="method-grid">{children}</div>
    </div>
  );
}

function ConceptCard({
  icon,
  title,
  tag,
  tagColor,
  summary,
  children,
}: {
  icon: string;
  title: string;
  tag: string;
  tagColor: "green" | "blue" | "purple" | "yellow";
  summary: string;
  children: React.ReactNode;
}) {
  const colors: Record<string, string> = {
    green: "#16a34a",
    blue: "#3b82f6",
    purple: "#8b5cf6",
    yellow: "#f59e0b",
  };
  return (
    <div className="method-card">
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginBottom: 10,
          paddingBottom: 10,
          borderBottom: "1px solid var(--color-border)",
        }}
      >
        <span style={{ fontSize: 20 }}>{icon}</span>
        <div style={{ flex: 1 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <span
              style={{
                fontWeight: 600,
                fontSize: 14,
                color: "var(--color-text-primary)",
              }}
            >
              {title}
            </span>
            <span
              style={{
                fontSize: 10,
                fontWeight: 600,
                padding: "1px 6px",
                borderRadius: 4,
                background: `${colors[tagColor]}22`,
                color: colors[tagColor],
                border: `1px solid ${colors[tagColor]}44`,
              }}
            >
              {tag}
            </span>
          </div>
          <div
            style={{ fontSize: 11, color: "var(--color-text-muted)", marginTop: 2 }}
          >
            {summary}
          </div>
        </div>
      </div>
      <div
        style={{
          fontSize: 12,
          color: "var(--color-text-muted)",
          lineHeight: 1.6,
        }}
      >
        {children}
      </div>
    </div>
  );
}

function KeyFact({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        marginTop: 10,
        padding: "7px 10px",
        background: "rgba(165,255,17,0.06)",
        border: "1px solid rgba(165,255,17,0.2)",
        borderRadius: 6,
        fontSize: 11,
        color: "var(--color-brand-600)",
        lineHeight: 1.5,
      }}
    >
      {children}
    </div>
  );
}

function Hierarchy({ items }: { items: { label: string; children: string[] }[] }) {
  return (
    <div
      style={{
        margin: "10px 0",
        padding: "8px 10px",
        background: "#0d1117",
        borderRadius: 6,
        fontFamily: "Courier New, monospace",
        fontSize: 11,
        color: "#8e8e8e",
      }}
    >
      {items.map((item) => (
        <div key={item.label}>
          <div style={{ color: "#a5ff11", marginBottom: 2 }}>
            📁 {item.label}
          </div>
          {item.children.map((c) => (
            <div key={c} style={{ paddingLeft: 16 }}>
              └── {c}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function Step({
  n,
  actor,
  children,
}: {
  n: number;
  actor: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        gap: 14,
        marginBottom: 16,
      }}
    >
      <div
        style={{
          width: 26,
          height: 26,
          borderRadius: "50%",
          background: "var(--color-brand-600)",
          color: "#000",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 12,
          fontWeight: 700,
          flexShrink: 0,
          marginTop: 2,
        }}
      >
        {n}
      </div>
      <div style={{ flex: 1 }}>
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: "var(--color-brand-600)",
            marginBottom: 4,
            textTransform: "uppercase",
            letterSpacing: 0.5,
          }}
        >
          {actor}
        </div>
        <div style={{ fontSize: 12, color: "var(--color-text-muted)", lineHeight: 1.6 }}>
          {children}
        </div>
      </div>
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
        padding: "8px 12px",
        fontFamily: "Courier New, monospace",
        fontSize: 11,
        color: "#a8d5a2",
        margin: "6px 0",
        overflowX: "auto",
        whiteSpace: "pre",
      }}
    >
      {children}
    </pre>
  );
}

function Aside({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 11,
        color: "var(--color-text-muted)",
        fontStyle: "italic",
        marginTop: 4,
      }}
    >
      ↳ {children}
    </div>
  );
}

function StateTypeCard({
  icon,
  title,
  color,
  replicated,
  examples,
  children,
}: {
  icon: string;
  title: string;
  color: "green" | "blue" | "cyan" | "red";
  replicated: boolean;
  examples: string;
  children: React.ReactNode;
}) {
  const colors: Record<string, string> = {
    green: "#16a34a",
    blue: "#3b82f6",
    cyan: "#06b6d4",
    red: "#ef4444",
  };
  return (
    <div className="method-card">
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 10,
          paddingBottom: 10,
          borderBottom: "1px solid var(--color-border)",
        }}
      >
        <span style={{ fontSize: 18 }}>{icon}</span>
        <div style={{ flex: 1 }}>
          <span
            style={{
              fontWeight: 600,
              fontSize: 13,
              color: colors[color],
            }}
          >
            {title}
          </span>
          <span
            style={{
              marginLeft: 8,
              fontSize: 10,
              padding: "1px 6px",
              borderRadius: 4,
              background: replicated ? "#16a34a22" : "#ef444422",
              color: replicated ? "#16a34a" : "#ef4444",
              border: `1px solid ${replicated ? "#16a34a44" : "#ef444444"}`,
              fontWeight: 600,
            }}
          >
            {replicated ? "synced" : "local only"}
          </span>
        </div>
      </div>
      <p
        style={{
          fontSize: 12,
          color: "var(--color-text-muted)",
          marginBottom: 8,
          lineHeight: 1.6,
        }}
      >
        {children}
      </p>
      <div
        style={{
          fontSize: 11,
          color: "var(--color-text-muted)",
          padding: "5px 8px",
          background: "#0d1117",
          borderRadius: 4,
          fontFamily: "Courier New, monospace",
        }}
      >
        {examples}
      </div>
    </div>
  );
}
