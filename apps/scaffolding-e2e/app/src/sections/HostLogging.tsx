import { useState } from "react";
import { ResultBox } from "../components/ResultBox";
import * as api from "../api/kvStore";

function useCall() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<unknown>(undefined);
  async function run(fn: () => Promise<unknown>) {
    setLoading(true);
    try {
      setResult(await fn());
    } catch (e) {
      setResult({ error: String(e) });
    } finally {
      setLoading(false);
    }
  }
  return { loading, result, run };
}

export function HostLogging() {
  const infoCall = useCall();
  const debugCall = useCall();
  const accountCall = useCall();

  return (
    <div>
      <div className="section-header">
        <h2 className="section-title">Host Logging &amp; Identity</h2>
        <p className="section-desc">
          A contract has two ways to say something. <code>app::log!</code> always
          reaches the execution outcome. The <code>tracing</code> macros only do
          if the app was built with the SDK&apos;s <code>tracing</code> feature,
          which installs a subscriber forwarding them to the same host log — it
          is off by default because the subscriber costs wasm size. This build
          turns it on.{" "}
          <strong>
            You cannot see the result on this page, and that is not a bug here.
          </strong>{" "}
          The node writes those lines to its own log and returns only the
          method&apos;s value — there is no <code>logs</code> field on a
          JSON-RPC reply. Run the probes, then look at the node:
          <br />
          <code>{"docker logs <node> 2>&1 | grep 'execution log'"}</code>
        </p>
      </div>

      <div className="method-grid">
        <div className="method-card">
          <div className="method-name">tracing_probe(debug: false)</div>
          <p className="method-hint">
            Emits one line at info, debug and warn, then writes a KV entry so{" "}
            <code>calimero-storage</code>&apos;s own instrumentation runs through
            the same path. The SDK&apos;s default level is <strong>WARN</strong>,
            not INFO — <code>calimero-storage</code> logs routine work at INFO
            and would flood every execution — so in the node&apos;s log you
            should see <strong>the warn line only</strong>, with info and debug
            both filtered out inside the guest.
          </p>
          <button
            className="btn-calimero"
            disabled={infoCall.loading}
            onClick={() => infoCall.run(() => api.tracingProbe(false))}
          >
            {infoCall.loading ? "..." : "Execute"}
          </button>
          <ResultBox result={infoCall.result} />
        </div>

        <div className="method-card">
          <div className="method-name">tracing_probe(debug: true)</div>
          <p className="method-hint">
            Same call, but it raises the level to DEBUG first. Now the debug line
            appears in the node&apos;s log, and so does{" "}
            <code>calimero_storage</code>&apos;s own output — which only happens
            if the subscriber is process-wide rather than scoped to the app
            crate. That difference is the actual test: it separates a live filter
            being retuned from a subscriber that was never installed. DEBUG on
            the storage crate is loud, so run it here rather than from a scenario
            that then greps for something specific.
          </p>
          <button
            className="btn-calimero-outline"
            disabled={debugCall.loading}
            onClick={() => debugCall.run(() => api.tracingProbe(true))}
          >
            {debugCall.loading ? "..." : "Execute at DEBUG"}
          </button>
          <ResultBox result={debugCall.result} />
        </div>

        <div className="method-card">
          <div className="method-name">my_account()</div>
          <p className="method-hint">
            The caller&apos;s account, 64 hex characters, on its own.{" "}
            <code>whoami</code> returns the same value alongside the device id
            and is the better call — one round trip for both halves. This one
            exists so the account accessor is spelled the same here as in
            core&apos;s copy of this scaffold, which is what keeps a merobox
            scenario portable between the two.
          </p>
          <button
            className="btn-calimero"
            disabled={accountCall.loading}
            onClick={() => accountCall.run(() => api.myAccount())}
          >
            {accountCall.loading ? "..." : "Execute"}
          </button>
          <ResultBox result={accountCall.result} />
        </div>
      </div>
    </div>
  );
}
