import React, { useState, useEffect } from 'react';
import { PenTool, Plus, Trash2, Edit3 } from 'lucide-react';
import { MobileLayout } from '../../components/MobileLayout';
import SignaturePadComponent from '../../components/SignaturePad';

interface SavedSignature {
  id: string;
  name: string;
  dataURL: string;
  createdAt: string;
}

export default function SignaturesPage() {
  const [signatures, setSignatures] = useState<SavedSignature[]>([]);
  const [showSignaturePad, setShowSignaturePad] = useState(false);

  // Load signatures from localStorage 
  useEffect(() => {
    const savedSignatures = localStorage.getItem('signatures');
    if (savedSignatures) {
      try {
        setSignatures(JSON.parse(savedSignatures));
      } catch (error) {
        console.error('Error loading signatures:', error);
      }
    }
  }, []);

  // Save signatures to localStorage 
  useEffect(() => {
    localStorage.setItem('signatures', JSON.stringify(signatures));
  }, [signatures]);

  const handleCreateSignature = () => {
    setShowSignaturePad(true);
  };

  const handleSaveSignature = (signatureData: string) => {
    const newSignature: SavedSignature = {
      id: Date.now().toString(),
      name: `Signature ${signatures.length + 1}`,
      dataURL: signatureData,
      createdAt: new Date().toLocaleDateString(),
    };

    setSignatures((prev) => [...prev, newSignature]);
    setShowSignaturePad(false);
  };

  const handleCancelSignature = () => {
    setShowSignaturePad(false);
  };


  const handleDeleteSignature = (id: string) => {
    // eslint-disable-next-line no-restricted-globals
    if (confirm('Are you sure you want to delete this signature?')) {
      setSignatures((prev) => prev.filter((sig) => sig.id !== id));
    }
  };

  return (
    <MobileLayout>
      {/* Page Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-current mb-2">
          Signature Library
        </h1>
        <p className="text-lg text-secondary">
          Manage your digital signatures for document signing
        </p>
      </div>

      {/* Action Bar */}
      <div className="flex justify-between items-center mb-6 gap-4">
        <button
          onClick={handleCreateSignature}
          className="flex items-center gap-2 px-6 py-3 rounded-lg border border-primary bg-primary text-black font-medium cursor-pointer transition-all duration-200 min-h-[44px] hover:-translate-y-1 hover:shadow-button active:translate-y-0"
        >
          <Plus size={20} />
          Create New Signature
        </button>
      </div>

      {signatures.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 md:gap-4">
          {signatures.map((signature) => (
            <div
              key={signature.id}
              className="bg-card border border-current rounded-xl p-6 transition-all duration-300 cursor-pointer hover:-translate-y-1 hover:shadow-large hover:border-primary"
            >
              <div className="h-20 bg-surface border border-current rounded-lg mb-4 flex items-center justify-center overflow-hidden">
                <img
                  src={signature.dataURL}
                  alt={signature.name}
                  className="max-w-full max-h-full object-contain"
                />
              </div>
              <div className="text-lg font-semibold text-current mb-2">
                {signature.name}
              </div>
              <div className="text-sm text-secondary mb-4">
                Created: {signature.createdAt}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => handleDeleteSignature(signature.id)}
                  className="flex-1 flex items-center justify-center gap-1 px-3 py-2 rounded border border-red-500 bg-red-500 text-white text-sm cursor-pointer transition-all duration-200 min-h-[36px] hover:opacity-90 hover:-translate-y-0.5 active:translate-y-0"
                >
                  <Trash2 size={16} />
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-16 text-secondary">
          <PenTool className="w-16 h-16 mx-auto mb-6 text-muted" />
          <div className="text-xl font-semibold text-current mb-2">
            No Signatures Yet
          </div>
          <div className="text-base mb-6">
            Create your first digital signature to start signing documents
          </div>
          <button
            onClick={handleCreateSignature}
            className="flex items-center gap-2 px-6 py-3 rounded-lg border border-primary bg-primary text-black font-medium cursor-pointer transition-all duration-200 min-h-[44px] hover:-translate-y-1 hover:shadow-button active:translate-y-0 mx-auto"
          >
            <Plus size={20} />
            Create Your First Signature
          </button>
        </div>
      )}

      {/* Signature Pad Component */}
      <SignaturePadComponent
        isOpen={showSignaturePad}
        onSave={handleSaveSignature}
        onCancel={handleCancelSignature}
      />
    </MobileLayout>
  );
}
