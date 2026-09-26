import { describe, it, expect } from 'vitest';
import ts from 'typescript';

// Mechanical enforcement for the copy rules: no em dash, no literal "..."
// (should be the "…" character) in anything a user actually sees. Only
// string literals / template literals / JSX text are checked — comments,
// imports and non-rendered strings are out of scope by design.
//
// Reads file contents via Vite's own `import.meta.glob` (not `node:fs`)
// because this app's dev config polyfills Node builtins for the browser
// bundle, which also stubs them out inside vitest.
const tsxFiles = import.meta.glob('../**/*.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

// .ts files are mostly hooks/logic where a string literal is an internal
// key, a regex, or a console-only diagnostic — scanning all of them would
// be mostly false positives. This allowlist covers the handful of .ts
// files whose string literals are known to reach the screen: the
// generated landing copy and the role/error copy tables consumed by
// components as-is.
const tsFiles = import.meta.glob(
  '../{pages/landing/landing.config,lib/roles,lib/folderLoadError}.ts',
  { query: '?raw', import: 'default', eager: true },
) as Record<string, string>;

interface Violation {
  file: string;
  text: string;
  reason: 'em-dash' | 'triple-dot';
}

const TEMPLATE_PART_KINDS: ts.SyntaxKind[] = [
  ts.SyntaxKind.TemplateHead,
  ts.SyntaxKind.TemplateMiddle,
  ts.SyntaxKind.TemplateTail,
];

function findViolations(
  file: string,
  source: string,
  scriptKind: ts.ScriptKind,
): Violation[] {
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind,
  );
  const violations: Violation[] = [];

  function check(text: string): void {
    if (text.includes('—')) violations.push({ file, text, reason: 'em-dash' });
    if (text.includes('...')) {
      violations.push({ file, text, reason: 'triple-dot' });
    }
  }

  // A module specifier (`import x from '...'`) is a StringLiteral too, but
  // it is never shown to anyone — skip it explicitly rather than relying on
  // its contents happening not to match.
  function isModuleSpecifier(node: ts.Node): boolean {
    const parent = node.parent;
    return (
      !!parent &&
      (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)) &&
      parent.moduleSpecifier === node
    );
  }

  function visit(node: ts.Node): void {
    if (
      (ts.isStringLiteralLike(node) && !isModuleSpecifier(node)) ||
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
  const scannedTsx = Object.entries(tsxFiles).filter(
    ([path]) =>
      !path.includes('/__tests__/') &&
      !path.includes('/generated/') &&
      !path.endsWith('/landing/LandingPage.tsx'),
  );
  const scannedTs = Object.entries(tsFiles);

  it('found files to scan', () => {
    expect(scannedTsx.length).toBeGreaterThan(0);
    expect(scannedTs.length).toBeGreaterThan(0);
  });

  it('has no em dash or literal "..." in string literals / JSX text', () => {
    const allViolations = [
      ...scannedTsx.flatMap(([path, source]) =>
        findViolations(path, source, ts.ScriptKind.TSX),
      ),
      ...scannedTs.flatMap(([path, source]) =>
        findViolations(path, source, ts.ScriptKind.TS),
      ),
    ];
    if (allViolations.length > 0) {
      const report = allViolations
        .map((v) => `${v.file} [${v.reason}]: ${v.text}`)
        .join('\n');
      throw new Error(`Copy violations found:\n${report}`);
    }
  });
});
