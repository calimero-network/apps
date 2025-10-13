import React, { useState, useEffect } from 'react';
import { Button, Modal } from 'react-bootstrap';

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{
    outcome: 'accepted' | 'dismissed';
    platform: string;
  }>;
  prompt(): Promise<void>;
}

const PWAInstallPrompt: React.FC = () => {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showInstallModal, setShowInstallModal] = useState(false);
  const [isInstalled, setIsInstalled] = useState(false);

  useEffect(() => {
    // Check if app is already installed
    const checkIfInstalled = () => {
      if (window.matchMedia('(display-mode: standalone)').matches) {
        setIsInstalled(true);
        return;
      }
      
      // Check for iOS Safari
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((window.navigator as any).standalone === true) {
        setIsInstalled(true);
        return;
      }
    };

    checkIfInstalled();

    // Listen for the beforeinstallprompt event
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      
      // Show install modal after a delay to not be too aggressive
      setTimeout(() => {
        if (!isInstalled) {
          setShowInstallModal(true);
        }
      }, 3000);
    };

    // Listen for app installed event
    const handleAppInstalled = () => {
      setIsInstalled(true);
      setShowInstallModal(false);
      setDeferredPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, [isInstalled]);

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;

    deferredPrompt.prompt();
    setDeferredPrompt(null);
    setShowInstallModal(false);
  };

  const handleDismiss = () => {
    setShowInstallModal(false);
    // Don't show again for this session
    sessionStorage.setItem('pwa-install-dismissed', 'true');
  };

  // Don't show if already installed or dismissed in this session
  if (isInstalled || sessionStorage.getItem('pwa-install-dismissed')) {
    return null;
  }

  return (
    <Modal 
      show={showInstallModal} 
      onHide={handleDismiss}
      centered
      backdrop="static"
      keyboard={false}
    >
      <Modal.Header closeButton>
        <Modal.Title>Install Curb Chat</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <div className="text-center">
          <div className="mb-3">
            <i className="bi bi-phone" style={{ fontSize: '3rem', color: '#007bff' }}></i>
          </div>
          <h5>Get the full app experience!</h5>
          <p className="text-muted">
            Install Curb Chat on your device for faster access, offline support, and a native app-like experience.
          </p>
          <ul className="list-unstyled text-start">
            <li className="mb-2">
              <i className="bi bi-check-circle-fill text-success me-2"></i>
              Quick access from your home screen
            </li>
            <li className="mb-2">
              <i className="bi bi-check-circle-fill text-success me-2"></i>
              Works offline
            </li>
            <li className="mb-2">
              <i className="bi bi-check-circle-fill text-success me-2"></i>
              Faster loading times
            </li>
            <li className="mb-2">
              <i className="bi bi-check-circle-fill text-success me-2"></i>
              Native app-like experience
            </li>
          </ul>
        </div>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="outline-secondary" onClick={handleDismiss}>
          Maybe Later
        </Button>
        <Button variant="primary" onClick={handleInstallClick}>
          Install App
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

export default PWAInstallPrompt;
