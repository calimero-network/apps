// One entry per colour, so a hex can never lose or swap its name. Order is the order new tags are assigned.
const TAG_PALETTE = [
  { hex: '#3b82f6', name: 'Blue' },
  { hex: '#8b5cf6', name: 'Purple' },
  { hex: '#10b981', name: 'Green' },
  { hex: '#f59e0b', name: 'Amber' },
  { hex: '#ec4899', name: 'Pink' },
  { hex: '#ef4444', name: 'Red' },
  { hex: '#14b8a6', name: 'Teal' },
  { hex: '#64748b', name: 'Slate' },
] as const;

export const TAG_COLORS = TAG_PALETTE.map((c) => c.hex);
export const TAG_COLOR_NAMES = TAG_PALETTE.map((c) => c.name); // accessible names for the swatches, same order
export const TAG_NEUTRAL = '#94a3b8'; // fallback for a tag with no assigned colour
