import { useEffect, useState } from 'react';
import { describeError, type Target } from '@calimero-apps/connect';

import { useSignedIn } from '../sessionContext';
import { Overlay, Dialog, Close, Field, Actions, SecondaryBtn, PrimaryBtn, ErrorLine, Spin } from './modalKit';

/** The env lines the MCP server (`mcp/`) needs for this cluster and workspace. */
export function mcpEnv(target: Target, key: string, workspace: string, bundle?: string): string {
  const lines =
    target.kind === 'local'
      ? [`CALIMERO_TARGET=local`, `CALIMERO_NODES=${target.nodes.join(',')}`, ...(bundle ? [`TRACKER_BUNDLE=${bundle}`] : [])]
      : target.direct
        ? [
            // An attested node the operator runs, reached by URL: no directory.
            `CALIMERO_TARGET=node`,
            `CALIMERO_NODES=${(target.nodes ?? []).join(',')}`,
            `CALIMERO_MIN_RELEASE=${target.minReleaseVersion}`,
          ]
        : [
            `CALIMERO_TARGET=cloud`,
            `CALIMERO_CLUSTER=${target.cluster}`,
            `CALIMERO_MIN_RELEASE=${target.minReleaseVersion}`,
          ];
  return [...lines, `CALIMERO_API_KEY=${key}`, `TRACKER_WORKSPACE=${workspace}`].join('\n');
}

/**
 * An API key for the MCP server: it acts for this account, so an agent files
 * and comments as you. Creating one is a passkey step-up; the key is shown
 * once. Replaces v1's "copy the node token out of devtools".
 */
export default function AgentKeyModal({ workspace, onClose }: { workspace: string; onClose: () => void }) {
  const { client, target, source, passkey, after } = useSignedIn();
  const [env, setEnv] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const { key } = await client.createApiKey({ label: 'mero-issue-tracker-mcp' }, passkey());
      setEnv(mcpEnv(target, key, workspace, typeof source === 'string' ? source : undefined));
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
      after();
    }
  };

  return (
    <Overlay onClick={() => !busy && onClose()}>
      <Dialog onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="agent-key-title">
        <Close onClick={() => !busy && onClose()} aria-label="Close">×</Close>
        <h3 id="agent-key-title">Agent key</h3>
        <p className="sub">
          A key for the issue tracker&apos;s MCP server, so a coding agent can file, triage and comment as you.
          It is shown once; revoke it from your account when you no longer need it.
        </p>
        {env ? (
          <Field>
            <label>MCP server environment</label>
            <textarea data-testid="agent-key-env" readOnly rows={6} value={env} onFocus={(e) => e.currentTarget.select()} />
          </Field>
        ) : (
          <Actions>
            <SecondaryBtn onClick={onClose} disabled={busy}>Cancel</SecondaryBtn>
            <PrimaryBtn data-testid="agent-key-create" onClick={() => void create()} disabled={busy}>
              {busy ? <Spin /> : 'Create key'}
            </PrimaryBtn>
          </Actions>
        )}
        {error && <ErrorLine>{error}</ErrorLine>}
      </Dialog>
    </Overlay>
  );
}
