import React, { useState, useRef, useEffect, useCallback } from 'react';
import { X, RotateCw } from 'lucide-react';
import { motion } from 'framer-motion';
import { SignaturePosition } from '../services/pdfService';

interface SignatureOverlayProps {
  signature: SignaturePosition;
  scale: number;
  onUpdate: (signature: SignaturePosition) => void;
  onDelete: (signatureId: string) => void;
  isSelected: boolean;
  onSelect: (signatureId: string) => void;
}

const SignatureOverlay: React.FC<SignatureOverlayProps> = ({
  signature,
  scale,
  onUpdate,
  onDelete,
  isSelected,
  onSelect,
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [resizeHandle, setResizeHandle] = useState<string | null>(null);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [initialBounds, setInitialBounds] = useState({
    x: 0,
    y: 0,
    width: 0,
    height: 0,
  });
  const [velocity, setVelocity] = useState({ x: 0, y: 0 });
  const [lastMoveTime, setLastMoveTime] = useState(0);
  const [lastPosition, setLastPosition] = useState({ x: 0, y: 0 });
  const [isInertiaActive, setIsInertiaActive] = useState(false);
  const overlayRef = useRef<HTMLDivElement>(null);

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onSelect(signature.id);

    const rect = e.currentTarget.getBoundingClientRect();
    const startX = e.clientX - rect.left;
    const startY = e.clientY - rect.top;

    setDragStart({ x: startX, y: startY });
    setIsDragging(true);
  };

  // Touch event handlers for mobile
  const handleTouchStart = (e: React.TouchEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onSelect(signature.id);
    triggerHapticFeedback('light');

    const rect = e.currentTarget.getBoundingClientRect();
    const touch = e.touches[0];
    const startX = touch.clientX - rect.left;
    const startY = touch.clientY - rect.top;

    setDragStart({ x: startX, y: startY });
    setIsDragging(true);
    setVelocity({ x: 0, y: 0 });
    setLastMoveTime(Date.now());
    setLastPosition({ x: touch.clientX, y: touch.clientY });
    setIsInertiaActive(false);
  };

  const applyInertia = useCallback(() => {
    if (!isInertiaActive) return;

    const container = overlayRef.current?.parentElement;
    if (!container) return;

    const canvas = container.querySelector('canvas');
    if (!canvas) return;

    const friction = 0.95;
    const threshold = 0.01;

    const animate = () => {
      setVelocity((prev) => {
        const newVelocityX = prev.x * friction;
        const newVelocityY = prev.y * friction;

        if (
          Math.abs(newVelocityX) < threshold &&
          Math.abs(newVelocityY) < threshold
        ) {
          setIsInertiaActive(false);
          return { x: 0, y: 0 };
        }

        // Apply velocity to position
        const newX = signature.x + newVelocityX * 10;
        const newY = signature.y + newVelocityY * 10;

        // Constrain to canvas bounds
        const constrainedX = Math.max(
          0,
          Math.min(newX, canvas.width - signature.width),
        );
        const constrainedY = Math.max(
          0,
          Math.min(newY, canvas.height - signature.height),
        );

        onUpdate({
          ...signature,
          x: constrainedX,
          y: constrainedY,
        });

        return { x: newVelocityX, y: newVelocityY };
      });

      if (isInertiaActive) {
        requestAnimationFrame(animate);
      }
    };

    requestAnimationFrame(animate);
  }, [isInertiaActive, signature, onUpdate]);

  // Haptic feedback for mobile
  const triggerHapticFeedback = useCallback(
    (intensity: 'light' | 'medium' | 'heavy' = 'light') => {
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        const vibrationPattern = {
          light: 10,
          medium: 25,
          heavy: 50,
        };
        navigator.vibrate(vibrationPattern[intensity]);
      }
    },
    [],
  );

  const handleResizeTouchStart = (e: React.TouchEvent, handle: string) => {
    e.preventDefault();
    e.stopPropagation();
    triggerHapticFeedback('medium');

    setResizeHandle(handle);
    setIsResizing(true);
    setInitialBounds({
      x: signature.x,
      y: signature.y,
      width: signature.width,
      height: signature.height,
    });

    // Store the touch position relative to the canvas
    const container = overlayRef.current?.parentElement;
    if (container) {
      const canvas = container.querySelector('canvas');
      if (canvas) {
        const canvasRect = canvas.getBoundingClientRect();
        const touch = e.touches[0];
        const touchX = touch.clientX - canvasRect.left;
        const touchY = touch.clientY - canvasRect.top;
        setDragStart({ x: touchX, y: touchY });
      }
    }
  };

  const handleResizeMouseDown = (e: React.MouseEvent, handle: string) => {
    e.preventDefault();
    e.stopPropagation();

    setResizeHandle(handle);
    setIsResizing(true);
    setInitialBounds({
      x: signature.x,
      y: signature.y,
      width: signature.width,
      height: signature.height,
    });

    // Store the mouse position relative to the canvas
    const container = overlayRef.current?.parentElement;
    if (container) {
      const canvas = container.querySelector('canvas');
      if (canvas) {
        const canvasRect = canvas.getBoundingClientRect();
        const mouseX = e.clientX - canvasRect.left;
        const mouseY = e.clientY - canvasRect.top;
        setDragStart({ x: mouseX, y: mouseY });
      }
    }
  };

  const handleMainResizeMouseDown = (e: React.MouseEvent) => {
    handleResizeMouseDown(e, 'bottom-right');
  };

  const handleMainResizeTouchStart = (e: React.TouchEvent) => {
    handleResizeTouchStart(e, 'bottom-right');
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging && overlayRef.current) {
        const container = overlayRef.current.parentElement;
        if (!container) return;

        const canvas = container.querySelector('canvas');
        if (!canvas) return;

        const canvasRect = canvas.getBoundingClientRect();

        // Convert mouse position to canvas coordinates
        const mouseX = e.clientX - canvasRect.left;
        const mouseY = e.clientY - canvasRect.top;

        const canvasX = (mouseX / canvasRect.width) * canvas.width;
        const canvasY = (mouseY / canvasRect.height) * canvas.height;

        // Adjust for drag offset (convert drag offset to canvas coordinates)
        const dragOffsetX = (dragStart.x / canvasRect.width) * canvas.width;
        const dragOffsetY = (dragStart.y / canvasRect.height) * canvas.height;

        const newX = canvasX - dragOffsetX;
        const newY = canvasY - dragOffsetY;

        onUpdate({
          ...signature,
          x: Math.max(0, newX),
          y: Math.max(0, newY),
        });
      }

      if (isResizing && resizeHandle) {
        const container = overlayRef.current?.parentElement;
        if (!container) return;

        const canvas = container.querySelector('canvas');
        if (!canvas) return;

        const canvasRect = canvas.getBoundingClientRect();
        const mouseX = e.clientX - canvasRect.left;
        const mouseY = e.clientY - canvasRect.top;

        const canvasX = (mouseX / canvasRect.width) * canvas.width;
        const canvasY = (mouseY / canvasRect.height) * canvas.height;

        const initialCanvasX = (dragStart.x / canvasRect.width) * canvas.width;
        const initialCanvasY =
          (dragStart.y / canvasRect.height) * canvas.height;

        const deltaX = canvasX - initialCanvasX;
        const deltaY = canvasY - initialCanvasY;

        let newProps = { ...signature };

        switch (resizeHandle) {
          case 'top-left':
            newProps.x = initialBounds.x + deltaX;
            newProps.y = initialBounds.y + deltaY;
            newProps.width = initialBounds.width - deltaX;
            newProps.height = initialBounds.height - deltaY;
            break;
          case 'top-right':
            newProps.y = initialBounds.y + deltaY;
            newProps.width = initialBounds.width + deltaX;
            newProps.height = initialBounds.height - deltaY;
            break;
          case 'bottom-left':
            newProps.x = initialBounds.x + deltaX;
            newProps.width = initialBounds.width - deltaX;
            newProps.height = initialBounds.height + deltaY;
            break;
          case 'bottom-right':
            newProps.width = initialBounds.width + deltaX;
            newProps.height = initialBounds.height + deltaY;
            break;
        }

        // Ensure minimum size
        newProps.width = Math.max(50, newProps.width);
        newProps.height = Math.max(25, newProps.height);

        onUpdate(newProps);
      }
    };

    const handleMouseUp = () => {
      if (
        isDragging &&
        Math.abs(velocity.x) > 0.1 &&
        Math.abs(velocity.y) > 0.1
      ) {
        // Apply momentum/inertia effect
        setIsInertiaActive(true);
        applyInertia();
      }
      setIsDragging(false);
      setIsResizing(false);
      setResizeHandle(null);
    };

    const handleTouchMove = (e: TouchEvent) => {
      e.preventDefault(); // Prevent scrolling and default behaviors

      if (isDragging && overlayRef.current) {
        const container = overlayRef.current.parentElement;
        if (!container) return;

        const canvas = container.querySelector('canvas');
        if (!canvas) return;

        const canvasRect = canvas.getBoundingClientRect();
        const touch = e.touches[0];
        const currentTime = Date.now();

        // Calculate velocity for momentum
        const timeDelta = currentTime - lastMoveTime;
        if (timeDelta > 0) {
          const velocityX = (touch.clientX - lastPosition.x) / timeDelta;
          const velocityY = (touch.clientY - lastPosition.y) / timeDelta;
          setVelocity({ x: velocityX, y: velocityY });
        }

        // Get current touch position relative to canvas
        const touchX = touch.clientX - canvasRect.left;
        const touchY = touch.clientY - canvasRect.top;

        // Convert to canvas coordinates
        const canvasX = (touchX / canvasRect.width) * canvas.width;
        const canvasY = (touchY / canvasRect.height) * canvas.height;

        // Calculate drag offset in canvas coordinates
        const dragOffsetX = (dragStart.x / canvasRect.width) * canvas.width;
        const dragOffsetY = (dragStart.y / canvasRect.height) * canvas.height;

        // Calculate new position
        const newX = canvasX - dragOffsetX;
        const newY = canvasY - dragOffsetY;

        // Apply constraints to keep signature within canvas bounds
        const constrainedX = Math.max(
          0,
          Math.min(newX, canvas.width - signature.width),
        );
        const constrainedY = Math.max(
          0,
          Math.min(newY, canvas.height - signature.height),
        );

        onUpdate({
          ...signature,
          x: constrainedX,
          y: constrainedY,
        });

        setLastMoveTime(currentTime);
        setLastPosition({ x: touch.clientX, y: touch.clientY });
      }

      if (isResizing && resizeHandle) {
        const container = overlayRef.current?.parentElement;
        if (!container) return;

        const canvas = container.querySelector('canvas');
        if (!canvas) return;

        const canvasRect = canvas.getBoundingClientRect();
        const touch = e.touches[0];
        const touchX = touch.clientX - canvasRect.left;
        const touchY = touch.clientY - canvasRect.top;

        const canvasX = (touchX / canvasRect.width) * canvas.width;
        const canvasY = (touchY / canvasRect.height) * canvas.height;

        const initialCanvasX = (dragStart.x / canvasRect.width) * canvas.width;
        const initialCanvasY =
          (dragStart.y / canvasRect.height) * canvas.height;

        const deltaX = canvasX - initialCanvasX;
        const deltaY = canvasY - initialCanvasY;

        let newProps = { ...signature };

        // Apply more responsive scaling for touch
        const scaleFactor = 1.2; // Makes resize more responsive to touch
        const scaledDeltaX = deltaX * scaleFactor;
        const scaledDeltaY = deltaY * scaleFactor;

        switch (resizeHandle) {
          case 'top-left':
            newProps.x = Math.max(0, initialBounds.x + scaledDeltaX);
            newProps.y = Math.max(0, initialBounds.y + scaledDeltaY);
            newProps.width = Math.max(50, initialBounds.width - scaledDeltaX);
            newProps.height = Math.max(25, initialBounds.height - scaledDeltaY);
            break;
          case 'top-right':
            newProps.y = Math.max(0, initialBounds.y + scaledDeltaY);
            newProps.width = Math.max(50, initialBounds.width + scaledDeltaX);
            newProps.height = Math.max(25, initialBounds.height - scaledDeltaY);
            break;
          case 'bottom-left':
            newProps.x = Math.max(0, initialBounds.x + scaledDeltaX);
            newProps.width = Math.max(50, initialBounds.width - scaledDeltaX);
            newProps.height = Math.max(25, initialBounds.height + scaledDeltaY);
            break;
          case 'bottom-right':
            newProps.width = Math.max(50, initialBounds.width + scaledDeltaX);
            newProps.height = Math.max(25, initialBounds.height + scaledDeltaY);
            break;
        }

        // Ensure signature doesn't go out of canvas bounds
        if (newProps.x + newProps.width > canvas.width) {
          newProps.width = canvas.width - newProps.x;
        }
        if (newProps.y + newProps.height > canvas.height) {
          newProps.height = canvas.height - newProps.y;
        }

        onUpdate(newProps);
      }
    };

    if (isDragging || isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.addEventListener('touchmove', handleTouchMove, {
        passive: false,
      });
      document.addEventListener('touchend', handleMouseUp);
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('touchend', handleMouseUp);
    };
  }, [
    isDragging,
    isResizing,
    signature,
    scale,
    dragStart,
    onUpdate,
    resizeHandle,
    initialBounds,
    lastMoveTime,
    lastPosition,
    velocity,
    applyInertia,
    isInertiaActive,
    triggerHapticFeedback,
  ]);

  const handleDelete = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    triggerHapticFeedback('heavy');
    onDelete(signature.id);
  };

  // Handle keyboard deletion
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isSelected && (e.key === 'Delete' || e.key === 'Backspace')) {
        e.preventDefault();
        onDelete(signature.id);
      }
    };

    if (isSelected) {
      document.addEventListener('keydown', handleKeyDown);
    }

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isSelected, signature.id, onDelete]);

  return (
    <motion.div
      ref={overlayRef}
      className={`signature-overlay absolute cursor-move ${
        isSelected
          ? 'border-2 border-blue-500 bg-blue-50/20'
          : 'border-2 border-gray-300 hover:border-blue-400'
      } ${isDragging ? 'opacity-80 shadow-lg' : ''} ${isResizing ? 'shadow-xl' : ''}`}
      style={{
        left: signature.x * scale,
        top: signature.y * scale,
        width: signature.width * scale,
        height: signature.height * scale,
        borderRadius: '4px',
        zIndex: isSelected ? 1000 : 100,
        transform: isDragging || isResizing ? 'scale(1.02)' : 'scale(1)',
        transition: isDragging || isResizing ? 'none' : 'transform 0.2s ease',
      }}
      onMouseDown={handleMouseDown}
      onTouchStart={handleTouchStart}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(signature.id);
      }}
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.2 }}
      whileTap={{ scale: 0.98 }}
    >
      {/* Signature Image */}
      <img
        src={signature.signatureData}
        alt="Signature"
        className="w-full h-full object-contain pointer-events-none"
        style={{
          filter: isSelected ? 'brightness(1.1)' : 'none',
        }}
      />

      {/* Controls (only show when selected) */}
      {isSelected && (
        <>
          {/* Delete button */}
          <motion.button
            className="absolute -top-10 -right-7 w-8 h-8 bg-red-500 text-white rounded-full flex items-center justify-center hover:bg-red-600 transition-colors shadow-lg"
            style={{ minWidth: '40px', minHeight: '40px' }}
            onClick={handleDelete}
            title="Delete signature"
            whileTap={{ scale: 0.9 }}
            whileHover={{ scale: 1.1 }}
          >
            <X size={14} />
          </motion.button>

          {/* Main resize handle */}
          <motion.div
            className="absolute -bottom-2 -right-2 w-8 h-8 bg-blue-500 text-white rounded-full flex items-center justify-center cursor-se-resize hover:bg-blue-600 transition-colors shadow-lg"
            style={{ minWidth: '40px', minHeight: '40px' }}
            onMouseDown={handleMainResizeMouseDown}
            onTouchStart={handleMainResizeTouchStart}
            title="Resize signature"
            whileTap={{ scale: 0.9 }}
            whileHover={{ scale: 1.1 }}
          >
            <RotateCw size={14} />
          </motion.div>

          {/* Corner handles */}
          <motion.div
            className="absolute -top-2 -left-2 w-6 h-6 bg-blue-500 rounded-full cursor-nw-resize flex items-center justify-center"
            style={{ minWidth: '32px', minHeight: '32px' }}
            onMouseDown={(e) => handleResizeMouseDown(e, 'top-left')}
            onTouchStart={(e) => handleResizeTouchStart(e, 'top-left')}
            whileTap={{ scale: 0.8 }}
            whileHover={{ scale: 1.2 }}
          >
            <div className="w-2 h-2 bg-white rounded-full" />
          </motion.div>
          <motion.div
            className="absolute -top-2 -right-2 w-6 h-6 bg-blue-500 rounded-full cursor-ne-resize flex items-center justify-center"
            style={{ minWidth: '32px', minHeight: '32px' }}
            onMouseDown={(e) => handleResizeMouseDown(e, 'top-right')}
            onTouchStart={(e) => handleResizeTouchStart(e, 'top-right')}
            whileTap={{ scale: 0.8 }}
            whileHover={{ scale: 1.2 }}
          >
            <div className="w-2 h-2 bg-white rounded-full" />
          </motion.div>
          <motion.div
            className="absolute -bottom-2 -left-2 w-6 h-6 bg-blue-500 rounded-full cursor-sw-resize flex items-center justify-center"
            style={{ minWidth: '32px', minHeight: '32px' }}
            onMouseDown={(e) => handleResizeMouseDown(e, 'bottom-left')}
            onTouchStart={(e) => handleResizeTouchStart(e, 'bottom-left')}
            whileTap={{ scale: 0.8 }}
            whileHover={{ scale: 1.2 }}
          >
            <div className="w-2 h-2 bg-white rounded-full" />
          </motion.div>
          <motion.div
            className="absolute -bottom-2 -right-2 w-6 h-6 bg-blue-500 rounded-full cursor-se-resize flex items-center justify-center"
            style={{ minWidth: '32px', minHeight: '32px' }}
            onMouseDown={(e) => handleResizeMouseDown(e, 'bottom-right')}
            onTouchStart={(e) => handleResizeTouchStart(e, 'bottom-right')}
            whileTap={{ scale: 0.8 }}
            whileHover={{ scale: 1.2 }}
          >
            <div className="w-2 h-2 bg-white rounded-full" />
          </motion.div>
        </>
      )}

      {/* Timestamp tooltip */}
      {isSelected && (
        <div className="absolute -bottom-8 left-0 bg-gray-800 text-white text-xs px-2 py-1 rounded shadow-lg whitespace-nowrap">
          Added: {new Date(signature.timestamp).toLocaleTimeString()}
        </div>
      )}
    </motion.div>
  );
};

export default SignatureOverlay;
