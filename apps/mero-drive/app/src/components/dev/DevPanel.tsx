// Rig console: which node this window talks to and an offline switch per node.
// App mounts it under import.meta.env.DEV only, so nothing here polls a
// production build.
import React from 'react';
import { Button } from '@/components/ui/button';
import {
  fetchDevNodes,
  selectedDevNode,
  setDevNodeOnline,
  type DevNode,
} from './devNode';

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
    void refresh();
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  if (nodes.length === 0) return null;

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
      <p className="mb-2 font-medium text-foreground">
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
    </aside>
  );
}
