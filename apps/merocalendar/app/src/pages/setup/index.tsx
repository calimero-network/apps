import React from 'react';
import { useNavigate } from 'react-router-dom';
import { SetupModal } from '@calimero-network/calimero-client';

export default function SetupPage() {
  const navigate = useNavigate();

  return (
    <div>
      <SetupModal successRoute={() => navigate('/login')} />
    </div>
  );
}
