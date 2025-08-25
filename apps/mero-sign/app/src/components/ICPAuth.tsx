import React, { useState, useEffect } from 'react';
import {
  loginWithInternetIdentity,
  logout,
  isAuthenticated,
  getIdentity,
} from '../api/icp/backendActor';

const ICPAuth: React.FC = () => {
  const [state, setState] = useState({
    isAuthenticated: false,
    principal: 'Click "Connect" to see your principal ID',
    isLoading: false,
  });

  // Check authentication status on component mount
  useEffect(() => {
    checkAuthStatus();
  }, []);

  const checkAuthStatus = async () => {
    try {
      const authenticated = await isAuthenticated();
      if (authenticated) {
        const identity = await getIdentity();
        const principal = identity.getPrincipal().toString();
        setState((prev) => ({
          ...prev,
          isAuthenticated: true,
          principal: principal,
        }));
      }
    } catch (error) {
      console.error('Error checking auth status:', error);
    }
  };

  const handleLogin = async () => {
    setState((prev) => ({ ...prev, isLoading: true }));
    try {
      const success = await loginWithInternetIdentity();
      if (success) {
        const identity = await getIdentity();
        const principal = identity.getPrincipal().toString();
        setState((prev) => ({
          ...prev,
          isAuthenticated: true,
          principal: principal,
          isLoading: false,
        }));
      } else {
        setState((prev) => ({ ...prev, isLoading: false }));
      }
    } catch (error) {
      console.error('Login failed:', error);
      setState((prev) => ({ ...prev, isLoading: false }));
    }
  };

  const handleLogout = async () => {
    try {
      await logout();
      setState({
        isAuthenticated: false,
        principal: 'Click "Connect" to see your principal ID',
        isLoading: false,
      });
    } catch (error) {
      console.error('Logout failed:', error);
    }
  };

  const Button: React.FC<{
    onClick: () => void;
    children: React.ReactNode;
    disabled?: boolean;
  }> = ({ onClick, children, disabled = false }) => (
    <button
      onClick={onClick}
      disabled={disabled}
      className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {children}
    </button>
  );

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">ICP Internet Identity</h1>

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
        <div className="flex items-start">
          <div className="text-blue-600 mr-3">
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                clipRule="evenodd"
              />
            </svg>
          </div>
          <div>
            <p className="text-sm text-blue-800">
              A <strong>principal</strong> is a unique identifier in the
              Internet Computer ecosystem.
            </p>
            <p className="text-sm text-blue-800 mt-2">
              It represents an entity (user, canister smart contract, or other)
              and is used for identification and authorization purposes.
            </p>
            <p className="text-sm text-blue-800 mt-2">
              After you've logged in with Internet Identity, you'll see a longer
              principal, which is unique to your identity and the dapp you're
              using.
            </p>
          </div>
        </div>
      </div>

      <div className="flex gap-4 mb-6">
        {!state.isAuthenticated ? (
          <Button onClick={handleLogin} disabled={state.isLoading}>
            {state.isLoading
              ? 'Connecting...'
              : 'Connect with Internet Identity'}
          </Button>
        ) : (
          <Button onClick={handleLogout}>Disconnect</Button>
        )}
      </div>

      {state.principal && (
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
          <h2 className="text-lg font-semibold mb-2">Your Principal ID:</h2>
          <h4 className="font-mono text-sm break-all bg-white p-2 rounded border">
            {state.principal}
          </h4>
        </div>
      )}
    </div>
  );
};

export default ICPAuth;
