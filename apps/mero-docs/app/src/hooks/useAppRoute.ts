// The workspace screen named by the URL, and the moves between screens. Each
// move is one history entry so back/forward walks the screens a user visited.

import { useCallback, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { appPath, parseAppPath, type AppRoute } from '@/lib/routes';

const DEV_NODE_PARAM = 'node'; // dev rig window selector, see components/dev/devNode

interface GoOptions {
  search?: string;
  replace?: boolean;
}

export function useAppRoute() {
  const { pathname, search, hash } = useLocation();
  const navigate = useNavigate();
  const route = useMemo(() => parseAppPath(pathname, hash), [pathname, hash]);
  const node = new URLSearchParams(search).get(DEV_NODE_PARAM);
  const ws = route?.ws;

  const current = pathname + search + hash;
  const go = useCallback(
    (target: AppRoute | null, opts: GoOptions = {}) => {
      const url = new URL(target ? appPath(target) : '/app', window.location.origin);
      url.search = opts.search ?? '';
      if (node) url.searchParams.set(DEV_NODE_PARAM, node);
      const next = url.pathname + url.search + url.hash;
      navigate(next, { replace: opts.replace || next === current });
    },
    [navigate, node, current],
  );

  const goWorkspace = useCallback(
    (next: string | null, opts?: { replace?: boolean }) =>
      go(next ? { ws: next } : null, opts),
    [go],
  );
  // Screens inside a workspace are no-ops until the URL names one.
  const goHome = useCallback(
    (homeSearch?: string) => {
      if (ws) go({ ws }, { search: homeSearch });
    },
    [go, ws],
  );
  const goFolder = useCallback(
    (folder: string, opts: { replace?: boolean } = {}) => {
      if (ws) go({ ws, folder }, opts);
    },
    [go, ws],
  );
  const goDoc = useCallback(
    (folder: string, doc: string, opts: { block?: string; replace?: boolean } = {}) => {
      if (ws) go({ ws, folder, doc, block: opts.block }, { replace: opts.replace });
    },
    [go, ws],
  );
  const goSettings = useCallback(() => {
    if (ws) go({ ws, settings: true });
  }, [go, ws]);

  return useMemo(
    () => ({ route, goWorkspace, goHome, goFolder, goDoc, goSettings }),
    [route, goWorkspace, goHome, goFolder, goDoc, goSettings],
  );
}
