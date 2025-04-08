import React from 'react';
import { ClientLogin } from '@calimero-network/calimero-client';
import { useNavigate } from 'react-router-dom';

export default function LoginPage() {
  const navigate = useNavigate();

  return (
    <div>
      <ClientLogin sucessRedirect={() => navigate('/')} />
    </div>
  );
}
