import { describe, it, expect } from 'vitest';
import ts from 'typescript';

// Enforces the copy rules (no em dash, "…" not "...") on string and JSX text; comments are out of scope.
// Uses import.meta.glob, not node:fs, because the app's Node polyfills stub fs inside vitest.
const tsxFiles = import.meta.glob('../**/*.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

// Most .ts strings are internal keys or diagnostics, so only the copy tables that reach the screen are scanned.
const tsFiles = import.meta.glob(
  '../{pages/landing/landing.config,lib/roles,lib/folderLoadError,lib/copyLink,lib/docLabel,lib/viewName,lib/relativeTime,hooks/useTags,hooks/useSavedViews,components/home/filterSummary,components/editor/blocknote/mentions}.ts',
  { query: '?raw', import: 'default', eager: true },
) as Record<string, string>;

const TS_COPY_FILE_COUNT = 11; // entries in the tsFiles glob; a rename must not drop one silently
const TEMPLATE_PART_KINDS: ts.SyntaxKind[] = [
  // template literal chunks around ${} holes
  ts.SyntaxKind.TemplateHead,
  ts.SyntaxKind.TemplateMiddle,
  ts.SyntaxKind.TemplateTail,
];

interface Violation {
  file: string;
  text: string;
  reason: 'em-dash' | 'triple-dot';
}

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
    if (text.includes('\u2014')) violations.push({ file, text, reason: 'em-dash' });
    if (text.includes('...')) {
      violations.push({ file, text, reason: 'triple-dot' });
    }
  }

  // A module specifier is a StringLiteral too, but it is never shown to anyone.
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
  // LandingPage.tsx is a verbatim copy of the shared landing template, so its
  // copy is fixed repo-wide, not here.
  const scannedTsx = Object.entries(tsxFiles).filter(
    ([path]) =>
      !path.includes('/__tests__/') &&
      !path.includes('/generated/') &&
      !path.endsWith('/landing/LandingPage.tsx'),
  );
  const scannedTs = Object.entries(tsFiles);

  it('found files to scan', () => {
    expect(scannedTsx.length).toBeGreaterThan(0);
    expect(scannedTs.length).toBe(TS_COPY_FILE_COUNT);
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
