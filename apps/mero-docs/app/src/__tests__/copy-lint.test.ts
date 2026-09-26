import { describe, it, expect } from 'vitest';
import ts from 'typescript';

// Mechanical enforcement for the copy rules: no em dash, no literal "..."
// (should be the "…" character) in anything a user actually sees. Only
// string literals / template literals / JSX text are checked — comments
// are out of scope by design.
//
// Reads file contents via Vite's own `import.meta.glob` (not `node:fs`)
// because this app's dev config polyfills Node builtins for the browser
// bundle, which also stubs them out inside vitest.
const files = import.meta.glob('../**/*.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

interface Violation {
  file: string;
  text: string;
  reason: 'em-dash' | 'triple-dot';
}

function findViolations(file: string, source: string): Violation[] {
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const violations: Violation[] = [];

  function check(text: string): void {
    if (text.includes('—')) violations.push({ file, text, reason: 'em-dash' });
    if (text.includes('...')) {
      violations.push({ file, text, reason: 'triple-dot' });
    }
  }

  const TEMPLATE_PART_KINDS: ts.SyntaxKind[] = [
    ts.SyntaxKind.TemplateHead,
    ts.SyntaxKind.TemplateMiddle,
    ts.SyntaxKind.TemplateTail,
  ];

  function visit(node: ts.Node): void {
    if (
      ts.isStringLiteralLike(node) ||
      node.kind === ts.SyntaxKind.JsxText ||
      TEMPLATE_PART_KINDS.includes(node.kind)
    ) {
      check(node.getText(sourceFile).trim());
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return violations;
}

describe('copy lint: no em dash or literal ellipsis in user-visible strings', () => {
  // LandingPage.tsx is copied byte-for-byte from scripts/landing/template
  // and shared by every app in the repo (see generate.mjs's VERBATIM list);
  // fixing its copy is a repo-wide change, out of scope for this app alone.
  const scanned = Object.entries(files).filter(
    ([path]) =>
      !path.includes('/__tests__/') &&
      !path.includes('/generated/') &&
      !path.endsWith('/landing/LandingPage.tsx'),
  );

  it('found .tsx files to scan', () => {
    expect(scanned.length).toBeGreaterThan(0);
  });

  it('has no em dash or literal "..." in string literals / JSX text', () => {
    const allViolations = scanned.flatMap(([path, source]) =>
      findViolations(path, source),
    );
    if (allViolations.length > 0) {
      const report = allViolations
        .map((v) => `${v.file} [${v.reason}]: ${v.text}`)
        .join('\n');
      throw new Error(`Copy violations found:\n${report}`);
    }
  });
});
