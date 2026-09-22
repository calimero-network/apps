import { COLOR_PRESETS } from '@/constants/config';

/**
 * The label and color peers see on this user's cursor. The color is a hex
 * preset because BlockNote picks the label's black or white text from hex only.
 */
export function cursorUser(
  selfIdentity: string | null,
  memberNames: Record<string, string>,
): { name: string; color: string } {
  const account = selfIdentity ?? 'anon';
  let h = 0;
  for (let i = 0; i < account.length; i++) {
    h = (h * 31 + account.charCodeAt(i)) % COLOR_PRESETS.length;
  }
  return {
    name:
      (selfIdentity && memberNames[selfIdentity]) ||
      (selfIdentity ? `${selfIdentity.slice(0, 6)}…` : 'Anonymous'),
    color: COLOR_PRESETS[h].value,
  };
}
