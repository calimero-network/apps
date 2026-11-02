import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCalimero } from '../lib/useCalimero';

/** Sign out (the session ends on the node, the stored copy is dropped), then back to the front door. */
export function useSignOut(): () => void {
  const { logout } = useCalimero();
  const navigate = useNavigate();
  return useCallback(() => {
    logout();
    navigate('/', { replace: true });
  }, [logout, navigate]);
}
