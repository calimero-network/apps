// The Legal Assistant may not be reachable while it cannot answer.
//
// Its retrieval half is real — a browser-side TensorFlow embedding and a
// genuine vector search against the document — so the feature LOOKS finished
// from the outside and from most of the code. Generation is the part that is
// missing: `handleSend` assembles a context, a history and a size budget, then
// ends at a TODO that prints a fixed "currently unavailable" line.
//
// That combination is exactly how a stub gets shipped by accident: someone
// tidies the flag, everything compiles, every other test passes, and the button
// comes back with nothing behind it. This pins the two together.
//
// ⚠️ Reads the source rather than importing it, deliberately. Importing
// `LegalChatbot` pulls in `embeddingService`, and with it pdf.js and
// TensorFlow — pdf.js needs `DOMMatrix`, which jsdom does not provide, so the
// suite cannot even load. The flag is a literal `const`, so reading it is
// unambiguous; what would be lost is a computed value, and it must not become
// one.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (name: string) =>
  readFileSync(fileURLToPath(new URL(name, import.meta.url)), 'utf8');

const chatbot = read('./LegalChatbot.tsx');
const viewer = read('./PDFViewer.tsx');

/** The canned reply that stands in for a real answer. */
const STUB_REPLY = 'LLM chatbot functionality is currently unavailable';

/** The flag's literal value, read from the declaration. */
function enabled(): boolean {
  const m = chatbot.match(
    /export const LEGAL_ASSISTANT_ENABLED = (true|false);/,
  );
  if (!m)
    throw new Error(
      'LEGAL_ASSISTANT_ENABLED is missing or is no longer a literal',
    );
  return m[1] === 'true';
}

describe('Legal Assistant availability', () => {
  it('is not reachable while handleSend still returns the stub reply', () => {
    if (chatbot.includes(STUB_REPLY)) {
      expect(
        enabled(),
        "handleSend still answers with the canned 'unavailable' line, so the " +
          'entry points must stay hidden. Wire up generation and remove that ' +
          'reply in the same change that sets this to true.',
      ).toBe(false);
    }
  });

  it('has no stub reply left once it is enabled', () => {
    if (enabled()) {
      expect(
        chatbot.includes(STUB_REPLY),
        "the assistant is enabled but still carries the canned 'unavailable' " +
          'reply — one of the two is wrong',
      ).toBe(false);
    }
  });

  // Hiding the modal but leaving a button is the failure that looks fine in a
  // diff, so every place that can reach the assistant is named here.
  it('gates every entry point on the flag', () => {
    // Structural, not a count of mentions: the first version of this counted
    // every occurrence of the name and so was satisfied by the comments beside
    // each gate — removing a real one still passed.
    expect(viewer).toContain(
      'import LegalChatbot, { LEGAL_ASSISTANT_ENABLED }',
    );
    // The desktop button, whose wrapper is hidden outright rather than
    // conditionally rendered (it has its own responsive classes).
    expect(viewer).toMatch(
      /className=\{LEGAL_ASSISTANT_ENABLED \? 'hidden sm:block' : 'hidden'\}/,
    );
    // The mobile menu item and the modal, each conditionally rendered.
    const blocks = viewer.match(/\{LEGAL_ASSISTANT_ENABLED && \(/g) ?? [];
    expect(blocks).toHaveLength(2);
  });

  // Reading the files is the whole mechanism, so a rename that quietly makes
  // the guard vacuous has to fail rather than pass.
  it('can actually read the sources it checks', () => {
    expect(chatbot).toContain('LEGAL_ASSISTANT_ENABLED');
    expect(chatbot.length).toBeGreaterThan(1000);
    expect(viewer.length).toBeGreaterThan(1000);
  });
});
