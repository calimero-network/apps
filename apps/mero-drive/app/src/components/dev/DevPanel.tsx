// Rig console: which node this window talks to, an offline switch per node,
// and a slot the editor work portals its inspector into. App mounts it under
// import.meta.env.DEV only, so nothing here polls a production build.
import React from 'react';
import { Button } from '@/components/ui/button';
import {
  fetchDevNodes,
  selectedDevNode,
  setDevNodeOnline,
  type DevNode,
} from './devNode';

/** Portal target for the per-node inspector: title, digest, block rows, gas. */
export const DEV_INSPECTOR_SLOT = 'dev-inspector';

const POLL_MS = 3000;

export default function DevPanel() {
  const [nodes, setNodes] = React.useState<DevNode[]>([]);
  const [busy, setBusy] = React.useState<number | null>(null);
  const selected = selectedDevNode();

  const refresh = React.useCallback(async () => {
    try {
      setNodes((await fetchDevNodes()).nodes);
    } catch {
      setNodes([]);
    }
  }, []);

  React.useEffect(() => {
    if (selected === null) return;
    void refresh();
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [refresh, selected]);

  // No `?node=`, no panel: it would otherwise sit over the landing page's own
  // controls in every dev window.
  if (selected === null || nodes.length === 0) return null;

  const toggle = async (node: DevNode) => {
    setBusy(node.index);
    try {
      await setDevNodeOnline(node.index, !node.online);
      await refresh();
    } finally {
      setBusy(null);
    }
  };

  return (
    <aside
      data-testid="dev-panel"
      className="fixed bottom-4 right-4 z-50 w-64 rounded-lg border border-border bg-background/95 p-3 text-xs shadow-lg backdrop-blur"
    >
      <p data-testid="node-label" className="mb-2 font-medium text-foreground">
        Rig - this window is node {selected}
      </p>
      <ul className="space-y-1">
        {nodes.map((node) => (
          <li key={node.index} className="flex items-center justify-between gap-2">
            <span
              className={node.index === selected ? 'text-foreground' : 'text-muted-foreground'}
            >
              node {node.index} {node.online ? 'online' : 'offline'}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={busy === node.index}
              data-testid={`dev-node-${node.index}-toggle`}
              onClick={() => void toggle(node)}
            >
              {node.online ? 'Take offline' : 'Bring online'}
            </Button>
          </li>
        ))}
      </ul>
      <div id={DEV_INSPECTOR_SLOT} className="peer mt-3 border-t border-border pt-2 empty:hidden" />
      <p className="mt-3 border-t border-border pt-2 text-muted-foreground peer-[&:not(:empty)]:hidden">
        No inspector mounted - per-node title, document digest, block rows and
        the last call's gas land here.
      </p>
    </aside>
  );
}
