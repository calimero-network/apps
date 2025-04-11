import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    getAccessToken,
    getAppEndpointKey,
    getApplicationId,
    getRefreshToken,
  } from '@calimero-network/calimero-client';

export default function AuthWrapper({
  children,
}: {
  children: React.ReactNode;
}) {
  const navigate = useNavigate();
  const url = getAppEndpointKey();
  const applicationId = getApplicationId();
  const accessToken = getAccessToken();
  const refreshToken = getRefreshToken();

  useEffect(() => {
    if (!url || !applicationId || !accessToken || !refreshToken) {
      navigate('/login');
    }
  }, [accessToken, applicationId, navigate, refreshToken, url]);

  return <>{children}</>;
}
