// The workspace screen named by the URL, and the moves between screens. Each
// move is one history entry so back/forward walks the screens a user visited.

import { useCallback, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { appPath, parseAppPath, type AppRoute } from '@/lib/routes';

export const DEV_NODE_PARAM = 'node'; // dev rig window selector, see components/dev/devNode

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
  // The relative URL of a screen, carrying the dev node param so a new tab stays on the same node.
  const href = useCallback(
    (target: AppRoute | null, targetSearch = '') => {
      const url = new URL(target ? appPath(target) : '/app', window.location.origin);
      url.search = targetSearch;
      if (node) url.searchParams.set(DEV_NODE_PARAM, node);
      return url.pathname + url.search + url.hash;
    },
    [node],
  );
  const go = useCallback(
    (target: AppRoute | null, opts: GoOptions = {}) => {
      const next = href(target, opts.search);
      navigate(next, { replace: opts.replace || next === current });
    },
    [navigate, href, current],
  );

  const goWorkspace = useCallback(
    (next: string | null, opts?: { replace?: boolean }) =>
      go(next ? { ws: next } : null, opts),
    [go],
  );
  // Screens inside a workspace are no-ops until the URL names one.
  const goHome = useCallback(
    (homeSearch?: string, opts: { replace?: boolean } = {}) => {
      if (ws) go({ ws }, { search: homeSearch, replace: opts.replace });
    },
    [go, ws],
  );
  const goFolder = useCallback(
    (folder: string, opts: GoOptions = {}) => {
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
    () => ({ route, href, goWorkspace, goHome, goFolder, goDoc, goSettings }),
    [route, href, goWorkspace, goHome, goFolder, goDoc, goSettings],
  );
}
