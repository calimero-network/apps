// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { parseAppPath } from './routes';

describe('route helpers without a window', () => {
  it('parse a path the e2e specs build in node', () => {
    expect(() => parseAppPath('/app/abc', '')).not.toThrow();
  });
});
