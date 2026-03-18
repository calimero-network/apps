import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCalimero } from '@calimero-network/calimero-client';
import { Hero } from '@/components/landing/Hero';
import { Features } from '@/components/landing/Features';
import { EditorPreview } from '@/components/landing/EditorPreview';
import { CTA } from '@/components/landing/CTA';
import { Footer } from '@/components/landing/Footer';

const Authenticate: React.FC = () => {
  const { isAuthenticated } = useCalimero();
  const navigate = useNavigate();

  useEffect(() => {
    if (isAuthenticated) {
      navigate('/home');
    }
  }, [isAuthenticated, navigate]);

  return (
    <div className="min-h-screen bg-background">
      <Hero />
      <Features />
      <EditorPreview />
      <CTA />
      <Footer />
    </div>
  );
};

export default Authenticate;
