import React, { useEffect } from 'react';
import {
  ContextModal,
  getAccessToken,
  getAppEndpointKey,
  getApplicationId,
  getRefreshToken,
} from '@calimero-network/calimero-client';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Home } from 'lucide-react';
import { MobileLayout } from '../../components/MobileLayout';

export default function ContextPage() {
  const navigate = useNavigate();

  useEffect(() => {
    const url = getAppEndpointKey();
    const applicationId = getApplicationId();
    const accessToken = getAccessToken();
    const refreshToken = getRefreshToken();

    if (!url || !applicationId) {
      navigate('/setup');
      return;
    }

    if (!accessToken || !refreshToken) {
      navigate('/auth');
    }
  }, [navigate]);

  return (
    <MobileLayout>
      {/* Page Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-current mb-2">
          Context Management
        </h1>
        <p className="text-lg text-secondary">
          Create or join a Calimero Context to start collaborating
        </p>
      </div>

      {/* Context Container */}
      <div className="bg-card border border-current rounded-xl p-8 mb-6 shadow-card">
        <ContextModal />
      </div>

      {/* Action Buttons */}
      <div className="flex gap-4 flex-wrap">
        <button
          onClick={() => navigate('/auth')}
          className="flex-1 flex items-center justify-center gap-2 px-6 py-3 rounded-lg border border-current bg-card text-current font-medium cursor-pointer transition-all duration-200 min-h-[44px] hover:-translate-y-1 hover:shadow-button active:translate-y-0"
        >
          <ArrowLeft size={20} />
          Back to Login
        </button>
        <button
          onClick={() => navigate('/home')}
          className="flex-1 flex items-center justify-center gap-2 px-6 py-3 rounded-lg border border-primary bg-primary text-black font-medium cursor-pointer transition-all duration-200 min-h-[44px] hover:-translate-y-1 hover:shadow-button active:translate-y-0"
        >
          <Home size={20} />
          Go to Home
        </button>
      </div>
    </MobileLayout>
  );
}
