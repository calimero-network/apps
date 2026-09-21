import { describe, it, expect } from 'vitest';
import { COLOR_PRESETS } from '@/constants/config';
import { cursorUser } from '../cursorUser';

const ALICE = 'a1b2c3d4e5f6'.padEnd(64, '0');

describe('cursorUser', () => {
  it('labels the cursor with the display name peers see in the members list', () => {
    expect(cursorUser(ALICE, { [ALICE]: 'Alice' }).name).toBe('Alice');
  });

  it('falls back to a truncated account when no name is set', () => {
    expect(cursorUser(ALICE, {}).name).toBe('a1b2c3…');
    expect(cursorUser(null, {}).name).toBe('Anonymous');
  });

  it('gives one account one hex preset color', () => {
    const { color } = cursorUser(ALICE, {});
    expect(COLOR_PRESETS.map((c) => c.value)).toContain(color);
    expect(cursorUser(ALICE, { [ALICE]: 'Alice' }).color).toBe(color);
  });
});
