import React, { useRef, useEffect, useState } from 'react';
import SignaturePad from 'signature_pad';
import { Save, RotateCcw } from 'lucide-react';
import { AnimatePresence } from 'framer-motion';
import {
  Button,
  Modal,
  Text,
  Box,
  Flex,
  spacing,
  colors,
  radius,
} from '@calimero-network/mero-ui';

interface SignaturePadComponentProps {
  onSave: (signatureData: string) => void;
  onCancel: () => void;
  isOpen: boolean;
}

const SignaturePadComponent: React.FC<SignaturePadComponentProps> = ({
  onSave,
  onCancel,
  isOpen,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [signaturePad, setSignaturePad] = useState<SignaturePad | null>(null);
  const [isEmpty, setIsEmpty] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (isOpen && canvasRef.current) {
      const canvas = canvasRef.current;

      const backgroundColor = '#ffffff';
      const penColor = '#000000';

      const pad = new SignaturePad(canvas, {
        backgroundColor: backgroundColor,
        penColor: penColor,
        minWidth: 2,
        maxWidth: 4,
      });

      const resizeCanvas = () => {
        const ratio = Math.max(window.devicePixelRatio || 1, 1);
        const rect = canvas.getBoundingClientRect();

        // Store the current signature data
        const data = pad.toData();

        canvas.width = rect.width * ratio;
        canvas.height = rect.height * ratio;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.scale(ratio, ratio);
          canvas.style.width = rect.width + 'px';
          canvas.style.height = rect.height + 'px';

          // Apply background color
          ctx.fillStyle = pad.backgroundColor;
          ctx.fillRect(0, 0, canvas.width, canvas.height);
        }

        // Restore the signature data
        pad.fromData(data);
      };

      // Initial resize and background setup
      setTimeout(() => {
        resizeCanvas();

        const ctx = canvas.getContext('2d');
        if (ctx) {
          const bgColor = '#ffffff';
          ctx.fillStyle = bgColor;
          ctx.fillRect(0, 0, canvas.width, canvas.height);
        }
      }, 100);

      // Listen for theme changes - now we'll rely on the useEffect dependency
      window.addEventListener('resize', resizeCanvas);

      pad.addEventListener('beginStroke', () => setIsEmpty(false));
      pad.addEventListener('endStroke', () => setIsEmpty(pad.isEmpty()));

      // Override the clear method to ensure background is always applied
      const originalClear = pad.clear.bind(pad);
      pad.clear = () => {
        originalClear();
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.fillStyle = pad.backgroundColor;
          ctx.fillRect(0, 0, canvas.width, canvas.height);
        }
      };

      setSignaturePad(pad);

      return () => {
        window.removeEventListener('resize', resizeCanvas);
        pad.off();
      };
    }
  }, [isOpen]);

  const handleSave = async () => {
    if (signaturePad && !signaturePad.isEmpty() && !isSaving) {
      setIsSaving(true);
      try {
        const dataURL = signaturePad.toDataURL('image/png');
        await onSave(dataURL);
      } finally {
        setIsSaving(false);
      }
    }
  };

  const handleClear = () => {
    if (signaturePad && canvasRef.current) {
      signaturePad.clear();

      const ctx = canvasRef.current.getContext('2d');
      if (ctx) {
        ctx.fillStyle = signaturePad.backgroundColor;
        ctx.fillRect(0, 0, canvasRef.current.width, canvasRef.current.height);
      }

      setIsEmpty(true);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <Modal open={isOpen} onClose={onCancel} title="Create Your Signature">
          <Box
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: spacing[4].value,
            }}
          >
            <Box className="text-center">
              <Text
                size="sm"
                className="text-muted-foreground"
                style={{ marginBottom: spacing[4].value }}
              >
                Draw your signature in the box below
              </Text>

              <Box className="relative">
                <canvas
                  ref={canvasRef}
                  className="w-full cursor-crosshair"
                  style={{
                    height: '192px',
                    border: `2px dashed ${colors.neutral[300]?.value || '#d1d5db'}`,
                    borderRadius: radius.md.value,
                    backgroundColor: colors.background.primary.value,
                  }}
                  width={600}
                  height={200}
                />
                {isEmpty && (
                  <Box className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <Text size="sm" className="text-muted-foreground">
                      Sign here using your mouse or touch screen
                    </Text>
                  </Box>
                )}
              </Box>

              <Flex
                style={{
                  gap: spacing[3].value,
                  paddingTop: spacing[4].value,
                  justifyContent: 'center',
                }}
              >
                <Button
                  variant="secondary"
                  onClick={handleClear}
                  disabled={isSaving}
                  style={{
                    padding: `${spacing[2].value} ${spacing[4].value}`,
                    ...(isSaving
                      ? {
                          opacity: 0.6,
                          cursor: 'not-allowed',
                          pointerEvents: 'none',
                        }
                      : {}),
                  }}
                >
                  <RotateCcw className="w-4 h-4 mr-2" />
                  Clear
                </Button>
                <Button
                  onClick={handleSave}
                  disabled={isEmpty || isSaving}
                  variant="primary"
                  style={{
                    padding: `${spacing[2].value} ${spacing[4].value}`,
                    ...(isEmpty || isSaving
                      ? {
                          backgroundColor: '#262626',
                          color: '#ffffff',
                          border: 'none',
                          cursor: 'not-allowed',
                          pointerEvents: 'none',
                        }
                      : {}),
                  }}
                >
                  <Save className="w-4 h-4 mr-2" />
                  {isSaving ? 'Saving...' : 'Save Signature'}
                </Button>
              </Flex>
            </Box>
          </Box>
        </Modal>
      )}
    </AnimatePresence>
  );
};

export default SignaturePadComponent;
