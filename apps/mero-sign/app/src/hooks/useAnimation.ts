import { useEffect, useRef, useState } from 'react';

interface UseSmoothAnimationOptions {
  threshold?: number;
  rootMargin?: string;
  triggerOnce?: boolean;
}

export const useSmoothAnimation = (options: UseSmoothAnimationOptions = {}) => {
  const { threshold = 0.1, rootMargin = '0px', triggerOnce = true } = options;

  const [isVisible, setIsVisible] = useState(false);
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          if (triggerOnce) {
            observer.unobserve(element);
          }
        } else if (!triggerOnce) {
          setIsVisible(false);
        }
      },
      { threshold, rootMargin },
    );

    observer.observe(element);

    return () => observer.disconnect();
  }, [threshold, rootMargin, triggerOnce]);

  return { ref, isVisible };
};

export const useDelayedAnimation = (delay: number = 0) => {
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setIsReady(true), delay);
    return () => clearTimeout(timer);
  }, [delay]);

  return isReady;
};

export const useStaggeredAnimation = (
  itemCount: number,
  delay: number = 100,
) => {
  const [visibleItems, setVisibleItems] = useState<Set<number>>(new Set());

  const triggerItem = (index: number) => {
    setTimeout(() => {
      setVisibleItems((prev) => new Set([...prev, index]));
    }, index * delay);
  };

  const triggerAll = () => {
    for (let i = 0; i < itemCount; i++) {
      triggerItem(i);
    }
  };

  const reset = () => {
    setVisibleItems(new Set());
  };

  return {
    visibleItems,
    triggerAll,
    reset,
    isVisible: (index: number) => visibleItems.has(index),
  };
};

// Button feedback hook for micro-interactions
export const useButtonFeedback = () => {
  const [isPressed, setIsPressed] = useState(false);

  const onMouseDown = () => setIsPressed(true);
  const onMouseUp = () => setIsPressed(false);
  const onMouseLeave = () => setIsPressed(false);

  return {
    isPressed,
    buttonProps: {
      onMouseDown,
      onMouseUp,
      onMouseLeave,
    },
    scale: isPressed ? 0.95 : 1,
  };
};
