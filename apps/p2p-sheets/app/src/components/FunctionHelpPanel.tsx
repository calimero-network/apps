/**
 * FunctionHelpPanel — slide-out panel listing all supported functions.
 *
 * Opens as a right-side overlay. Lists functions alphabetically with name,
 * syntax, description, and an example. A search box at the top filters the list.
 * Pressing Escape or clicking the backdrop closes it.
 */
import React, { useEffect, useRef, useState } from 'react';
import styled, { keyframes } from 'styled-components';
import { C } from '../theme';
import { type FunctionDef } from '../hooks/useSpreadsheet';

interface FunctionHelpPanelProps {
  functions: FunctionDef[];
  onClose: () => void;
}

export default function FunctionHelpPanel({
  functions,
  onClose,
}: FunctionHelpPanelProps) {
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Focus search on open, Escape closes
    searchRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const filtered = query.trim()
    ? functions.filter(
        (f) =>
          f.name.toLowerCase().includes(query.toLowerCase()) ||
          f.description.toLowerCase().includes(query.toLowerCase()),
      )
    : functions;

  // Sort alphabetically
  const sorted = [...filtered].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <Overlay
      onClick={onClose}
      role="presentation"
      aria-label="Close function help"
    >
      <Panel
        role="dialog"
        aria-modal="true"
        aria-label="Function reference"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <PanelHeader>
          <div className="title">
            <FxBadge aria-hidden="true">fx</FxBadge>
            <span>Function Reference</span>
          </div>
          <CloseBtn onClick={onClose} aria-label="Close function help">
            ×
          </CloseBtn>
        </PanelHeader>

        {/* Search */}
        <SearchWrap>
          <SearchIcon aria-hidden="true">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.35-4.35" />
            </svg>
          </SearchIcon>
          <SearchInput
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search functions…"
            aria-label="Search functions"
          />
          {query && (
            <ClearBtn onClick={() => setQuery('')} aria-label="Clear search">
              ×
            </ClearBtn>
          )}
        </SearchWrap>

        {/* Count */}
        <CountLine>
          {sorted.length === functions.length
            ? `${functions.length} functions`
            : `${sorted.length} of ${functions.length} functions`}
        </CountLine>

        {/* Function list */}
        <FnList>
          {sorted.length === 0 ? (
            <EmptyState>No functions match "{query}"</EmptyState>
          ) : (
            sorted.map((fn) => <FnCard key={fn.name} fn={fn} />)
          )}
        </FnList>
      </Panel>
    </Overlay>
  );
}

function FnCard({ fn }: { fn: FunctionDef }) {
  return (
    <FnItem>
      <FnName>{fn.name}</FnName>
      <FnSyntax>{fn.syntax}</FnSyntax>
      <FnDesc>{fn.description}</FnDesc>
      <FnExample>
        <span className="label">Example</span>
        <code>{fn.example}</code>
      </FnExample>
    </FnItem>
  );
}

// ── Styled components ────────────────────────────────────────────────────────

const slideIn = keyframes`
  from { transform: translateX(100%); opacity: 0; }
  to   { transform: none; opacity: 1; }
`;
const fadeIn = keyframes`
  from { opacity: 0; }
  to   { opacity: 1; }
`;

const Overlay = styled.div`
  position: fixed;
  inset: 0;
  z-index: 200;
  background: rgba(14, 20, 15, 0.3);
  backdrop-filter: blur(2px);
  animation: ${fadeIn} 0.18s ease;
  display: flex;
  justify-content: flex-end;
`;

const Panel = styled.div`
  width: 420px;
  max-width: 100vw;
  height: 100%;
  background: ${C.paper};
  border-left: 1px solid ${C.line};
  display: flex;
  flex-direction: column;
  animation: ${slideIn} 0.22s cubic-bezier(0.22, 1, 0.36, 1);
  box-shadow: -20px 0 60px -20px rgba(14, 20, 15, 0.25);
`;

const PanelHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 18px;
  border-bottom: 1px solid ${C.line};
  flex-shrink: 0;

  .title {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 15px;
    font-weight: 700;
    color: ${C.ink};
    letter-spacing: -0.2px;
  }
`;

const FxBadge = styled.span`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 8px;
  background: rgba(164, 255, 17, 0.16);
  border: 1px solid rgba(164, 255, 17, 0.4);
  font-size: 12px;
  font-style: italic;
  font-family: ui-monospace, 'SF Mono', Menlo, monospace;
  color: ${C.greenDeep};
`;

const CloseBtn = styled.button`
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
  font-size: 20px;
  line-height: 1;
  color: ${C.mutedSoft};
  background: transparent;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;

  &:hover {
    background: ${C.paper2};
    color: ${C.ink};
  }
`;

const SearchWrap = styled.div`
  position: relative;
  padding: 12px 14px;
  border-bottom: 1px solid ${C.line};
  flex-shrink: 0;
  display: flex;
  align-items: center;
`;

const SearchIcon = styled.div`
  position: absolute;
  left: 24px;
  color: ${C.muted};
  display: flex;
  align-items: center;
`;

const SearchInput = styled.input`
  width: 100%;
  padding: 9px 34px 9px 34px;
  font-size: 13.5px;
  color: ${C.ink};
  background: ${C.paper2};
  border: 1px solid ${C.line};
  border-radius: 10px;
  outline: none;
  transition: border-color 0.15s, box-shadow 0.15s;

  &::placeholder {
    color: ${C.mutedSoft};
  }

  &:focus {
    border-color: ${C.green};
    box-shadow: 0 0 0 3px rgba(164, 255, 17, 0.18);
  }
`;

const ClearBtn = styled.button`
  position: absolute;
  right: 24px;
  width: 20px;
  height: 20px;
  display: grid;
  place-items: center;
  font-size: 16px;
  color: ${C.mutedSoft};
  background: transparent;
  border: none;
  border-radius: 5px;
  cursor: pointer;
  transition: color 0.12s;

  &:hover { color: ${C.ink}; }
`;

const CountLine = styled.div`
  padding: 6px 18px;
  font-size: 11.5px;
  color: ${C.mutedSoft};
  border-bottom: 1px solid ${C.line};
  flex-shrink: 0;
`;

const FnList = styled.div`
  flex: 1;
  overflow-y: auto;
  padding: 8px 0;
  scrollbar-width: thin;
  scrollbar-color: ${C.line} transparent;
`;

const FnItem = styled.div`
  padding: 14px 18px;
  border-bottom: 1px solid ${C.line};

  &:last-child { border-bottom: none; }
  &:hover { background: ${C.paper2}; }
`;

const FnName = styled.div`
  font-size: 15px;
  font-weight: 700;
  font-family: ui-monospace, 'SF Mono', Menlo, monospace;
  color: ${C.green};
  letter-spacing: 0.04em;
  margin-bottom: 3px;
`;

const FnSyntax = styled.div`
  font-size: 13px;
  font-family: ui-monospace, 'SF Mono', Menlo, monospace;
  color: ${C.muted};
  margin-bottom: 6px;
`;

const FnDesc = styled.div`
  font-size: 13px;
  color: ${C.ink};
  line-height: 1.5;
  margin-bottom: 8px;
`;

const FnExample = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;

  .label {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: ${C.mutedSoft};
    flex-shrink: 0;
  }

  code {
    font-size: 12.5px;
    font-family: ui-monospace, 'SF Mono', Menlo, monospace;
    color: ${C.greenDeep};
    background: rgba(164, 255, 17, 0.1);
    padding: 2px 8px;
    border-radius: 6px;
    border: 1px solid rgba(164, 255, 17, 0.3);
  }
`;

const EmptyState = styled.div`
  padding: 40px 18px;
  text-align: center;
  font-size: 14px;
  color: ${C.muted};
`;
