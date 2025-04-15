import {
  getAppEndpointKey,
  getApplicationId,
  getContextId,
  getExecutorPublicKey,
} from '@calimero-network/calimero-client';
import { useState, useEffect } from 'react';

export const useAuth = () => {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const pk = getExecutorPublicKey();
  const contextId = getContextId();
  const appId = getApplicationId();
  const nodeUrl = getAppEndpointKey();

  useEffect(() => {
    if (pk && contextId && appId && nodeUrl) {
      setIsLoggedIn(true);
    } else {
      setIsLoggedIn(false);
    }
  }, [pk, contextId, appId, nodeUrl]);

  return { isLoggedIn };
};
