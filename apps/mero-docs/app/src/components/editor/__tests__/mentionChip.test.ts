// A mention renders as a person chip, told apart from a doc chip by its href.
import { describe, expect, it } from 'vitest';
import postcss, { type Rule } from 'postcss';
import css from '@/index.css?raw';

const DOC_CHIP = ".bn-editor a[href^='/app/']";
const PERSON_CHIP = `${DOC_CHIP}[href*='/m/']`;

function decls(selector: string): Record<string, string> {
  const out: Record<string, string> = {};
  postcss.parse(css).walkRules((rule: Rule) => {
    if (rule.selector === selector)
      rule.walkDecls((d) => {
        out[d.prop] = d.value;
      });
  });
  return out;
}

describe('mention chip', () => {
  it('is a round pill with its own fill and a person icon, not the doc chip underline', () => {
    const person = decls(PERSON_CHIP);
    const doc = decls(DOC_CHIP);
    expect(person['border-radius']).toBe('999px');
    expect(person['border-bottom']).toBe('none');
    expect(person['--doc-chip']).not.toBe(doc['--doc-chip']);
    expect(person['--doc-chip-icon']).toMatch(/circle cx='12' cy='10' r='4'/);
  });

  it('keeps the focus ring its outline would otherwise replace', () => {
    expect(decls(`${PERSON_CHIP}:focus-visible`)['box-shadow']).toBe(
      '0 0 0 2px hsl(var(--ring))',
    );
  });

  it('comes after the doc chip, so it wins over it in light and dark', () => {
    const selectors: string[] = [];
    postcss.parse(css).walkRules((rule: Rule) => {
      selectors.push(rule.selector);
    });
    expect(selectors.indexOf(PERSON_CHIP)).toBeGreaterThan(
      selectors.indexOf(`.dark ${DOC_CHIP}`),
    );
  });
});
