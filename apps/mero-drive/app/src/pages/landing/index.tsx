import React, { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Hero } from '@/components/landing/Hero';
import { Features } from '@/components/landing/Features';
import { EditorPreview } from '@/components/landing/EditorPreview';
import { CTA } from '@/components/landing/CTA';
import { Footer } from '@/components/landing/Footer';

const LandingPage: React.FC = () => {
  const navigate = useNavigate();
  const onConnect = useCallback(() => navigate('/login'), [navigate]);

  return (
    <div className="min-h-screen bg-background">
      <Hero onConnect={onConnect} />
      <Features />
      <EditorPreview />
      <CTA onConnect={onConnect} />
      <Footer />
    </div>
  );
};

export default LandingPage;
