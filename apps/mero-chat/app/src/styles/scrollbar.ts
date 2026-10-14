import { css } from "styled-components";

/**
 * Shared scrollbar styles for consistent look across the app
 */
export const scrollbarStyles = css`
  scrollbar-color: var(--glass-line-strong) var(--glass-line-strong);

  ::-webkit-scrollbar {
    width: 6px;
  }

  ::-webkit-scrollbar-thumb {
    background-color: var(--glass-line-strong);
    border-radius: 6px;
  }

  ::-webkit-scrollbar-thumb:hover {
    background-color: var(--glass-line-strong);
  }

  * {
    scrollbar-color: var(--glass-line-strong) var(--glass-line-strong);
  }

  html::-webkit-scrollbar {
    width: 12px;
  }

  html::-webkit-scrollbar-thumb {
    background-color: var(--glass-line-strong);
    border-radius: 6px;
  }

  html::-webkit-scrollbar-thumb:hover {
    background-color: var(--glass-line-strong);
  }
`;

/**
 * Performance optimizations for smooth scrolling
 */
export const scrollPerformanceStyles = css`
  /* Optimize scrolling performance */
  contain: layout style paint;
  overflow-anchor: none;

  /* GPU acceleration for smoother rendering */
  transform: translateZ(0);
  backface-visibility: hidden;
`;
