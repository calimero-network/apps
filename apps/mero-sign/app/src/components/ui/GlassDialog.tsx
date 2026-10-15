import { useEffect, useId, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import styles from './GlassDialog.module.css';

/**
 * A dialog in the glass look, rendered into <body>.
 *
 * ⚠️ PORTALLED ON PURPOSE. The signing dialogs open from inside the document
 * viewer, and the viewer sits in an overlay inside the app shell. Any ancestor
 * with a `transform`, `filter` or `backdrop-filter` becomes the containing
 * block of a `position: fixed` descendant, which is how the signature picker
 * used to open as a sliver clipped to the bottom of the viewer on a phone.
 * From <body> the scrim always covers the whole viewport.
 *
 * On a phone it is a bottom sheet; from 640px up, a centred card.
 */
export default function GlassDialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  testId,
  layer = 'base',
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  /** `data-testid` on the dialog panel itself. */
  testId?: string;
  /** `top` for a dialog opened from another dialog. */
  layer?: 'base' | 'top';
}) {
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // The viewer behind closes on Escape too; this one goes first.
        e.stopImmediatePropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className={`${styles.scrim} ${layer === 'top' ? styles.top : ''}`}
      onClick={onClose}
    >
      <div
        className={`${styles.panel} ${styles[size]}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid={testId}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.grip} aria-hidden="true" />
        <header className={styles.head}>
          <div className={styles.headText}>
            <h2 className={styles.title} id={titleId}>
              {title}
            </h2>
            {description && <p className={styles.description}>{description}</p>}
          </div>
          <button
            type="button"
            className={styles.close}
            onClick={onClose}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </header>
        {children && <div className={styles.body}>{children}</div>}
        {footer && <footer className={styles.footer}>{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}
