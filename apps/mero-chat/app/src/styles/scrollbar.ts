import { css } from 'styled-components';

/**
 * Shared scrollbar styles for consistent look across the app
 */
export const scrollbarStyles = css`
  scrollbar-color: black black;
  
  ::-webkit-scrollbar {
    width: 6px;
  }
  
  ::-webkit-scrollbar-thumb {
    background-color: black;
    border-radius: 6px;
  }
  
  ::-webkit-scrollbar-thumb:hover {
    background-color: black;
  }
  
  * {
    scrollbar-color: black black;
  }
  
  html::-webkit-scrollbar {
    width: 12px;
  }
  
  html::-webkit-scrollbar-thumb {
    background-color: black;
    border-radius: 6px;
  }
  
  html::-webkit-scrollbar-thumb:hover {
    background-color: black;
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

