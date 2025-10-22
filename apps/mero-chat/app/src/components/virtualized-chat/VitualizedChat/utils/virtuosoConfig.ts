/**
 * Utility functions and constants for Virtuoso configuration
 * Following DRY principle and Virtuoso best practices
 * Reference: https://virtuoso.dev/
 */

export const VIRTUOSO_CONFIGS = {
  style: { height: "100%", width: "100%" },
  // Optimized overscan for smooth scrolling without excess rendering
  overscan: { reverse: 300, main: 300 },
  // Balanced viewport buffer
  viewport: { top: 200, bottom: 200 },
  // Reasonable default for variable-height messages
  defaultItemHeight: 80,
  atBottomThreshold: 50,
} as const;

export const INITIAL_ITEM_INDEX = 10000;
