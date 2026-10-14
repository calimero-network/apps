import React, { useRef, useEffect, useState } from 'react';
import SignaturePad from 'signature_pad';
import { Check, RotateCcw } from 'lucide-react';
import GlassDialog from './ui/GlassDialog';
import ui from './ui/controls.module.css';
import styles from './SignaturePad.module.css';

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
      // A fresh pad each time it opens, so it starts empty.
      setIsEmpty(true);

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
        // Layout size, not getBoundingClientRect: the dialog opens with a
        // scale animation, and the transformed box measured mid-animation
        // made the drawing surface smaller than the canvas on screen.
        const rect = { width: canvas.offsetWidth, height: canvas.offsetHeight };

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
    <GlassDialog
      open={isOpen}
      onClose={onCancel}
      title="Draw your signature"
      description="Use your mouse, trackpad or finger."
      size="lg"
      layer="top"
      footer={
        <>
          <button
            type="button"
            className={ui.ghost}
            onClick={handleClear}
            disabled={isSaving || isEmpty}
          >
            <RotateCcw size={16} />
            Clear
          </button>
          <button
            type="button"
            className={ui.btn}
            onClick={handleSave}
            disabled={isEmpty || isSaving}
            data-testid="save-signature"
          >
            {isSaving ? <span className={ui.spinner} /> : <Check size={16} />}
            {isSaving ? 'Saving…' : 'Save signature'}
          </button>
        </>
      }
    >
      {/* Paper-white in both themes: this is ink on a document. */}
      <div className={styles.paper}>
        <canvas
          ref={canvasRef}
          data-testid="signature-pad"
          className={styles.canvas}
          width={600}
          height={200}
        />
        <span className={styles.baseline} aria-hidden="true">
          <span className={styles.cross}>×</span>
        </span>
        {isEmpty && (
          <span className={styles.placeholder}>Sign here</span>
        )}
      </div>
    </GlassDialog>
  );
};

export default SignaturePadComponent;
