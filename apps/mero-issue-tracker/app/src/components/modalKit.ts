// Shared modal styling primitives, factored out of SetAliasModal/JoinModal so
// the onboarding dialogs (create namespace, add repo, alias gate) share one
// look without re-deriving the same styled blocks each time.
import styled, { keyframes } from 'styled-components';
import { tokens as t } from '../theme';

const fadeIn = keyframes`from{opacity:0;}to{opacity:1;}`;
const pop = keyframes`from{opacity:0;transform:translateY(8px);}to{opacity:1;transform:none;}`;
const spin = keyframes`to{transform:rotate(360deg);}`;

export const Overlay = styled.div`
  position: fixed; inset: 0; z-index: 100;
  display: flex; align-items: center; justify-content: center; padding: 20px;
  background: ${t.color.scrim};
  /* The overlay is fixed itself and holds only its dialog, so this blur
     cannot trap anything. */
  -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px);
  animation: ${fadeIn} 0.15s ease both;
`;
export const Dialog = styled.div`
  position: relative; width: 100%; max-width: 420px;
  background: ${t.color.panel}; border: 1px solid ${t.color.edge}; border-radius: ${t.radiusModal};
  padding: 30px 28px 26px; box-shadow: ${t.shadowFloat};
  max-height: calc(100dvh - 40px); overflow-y: auto;
  font-family: ${t.font.sans}; color: ${t.color.text};
  animation: ${pop} 0.18s ease both;
  h3 { font-size: 20px; font-weight: 700; letter-spacing: -0.03em; margin: 0 0 8px; padding-right: 28px; }
  .sub { font-size: 13px; line-height: 1.55; color: ${t.color.text2}; margin: 0; }
`;
export const Close = styled.button`
  position: absolute; top: 16px; right: 16px; width: 32px; height: 32px;
  display: grid; place-items: center; font-size: 20px; line-height: 1;
  color: ${t.color.text3}; background: transparent; border: none; border-radius: 999px; cursor: pointer;
  &:hover { background: ${t.color.hover}; color: ${t.color.text}; }
`;
export const Field = styled.div`
  margin: 20px 0 4px;
  label { display: block; font-size: 12px; font-weight: 600; color: ${t.color.text2}; margin-bottom: 7px; }
  input {
    width: 100%; box-sizing: border-box;
    font-size: 13px; color: ${t.color.text}; background: ${t.color.raised};
    border: 1px solid ${t.color.borderStrong}; border-radius: ${t.radius}; padding: 11px 14px;
    outline: none; font-family: inherit;
    &::placeholder { color: ${t.color.text3}; }
    &:focus { border-color: ${t.color.accentBorder}; box-shadow: 0 0 0 3px ${t.focus}; }
    &:disabled { opacity: 0.6; }
  }
`;
export const Actions = styled.div`display: flex; gap: 10px; justify-content: flex-end; margin-top: 18px;`;
const btn = `
  min-height: 40px; padding: 0 20px; font-family: inherit; font-size: 13.5px; font-weight: 600;
  border-radius: 999px; cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
  &:disabled { opacity: 0.6; cursor: default; }
`;
export const SecondaryBtn = styled.button`
  ${btn}
  color: ${t.color.text}; background: ${t.color.raised}; border: 1px solid ${t.color.borderStrong};
  &:hover:not(:disabled) { background: ${t.color.hover}; }
`;
export const PrimaryBtn = styled.button`
  ${btn}
  min-width: 120px; display: inline-flex; align-items: center; justify-content: center;
  color: ${t.color.onAccent}; background: ${t.color.accent}; border: 1px solid transparent;
  box-shadow: 0 10px 24px -12px rgba(14, 18, 34, 0.6);
  &:hover:not(:disabled) { background: ${t.color.accentHover}; }
`;
export const ErrorLine = styled.p`margin: 12px 0 0; font-size: 12.5px; color: ${t.color.urgent};`;
export const Spin = styled.span`
  width: 15px; height: 15px; border: 2px solid color-mix(in srgb, var(--glass-on-ink) 30%, transparent); border-top-color: ${t.color.onAccent};
  border-radius: 50%; animation: ${spin} 0.6s linear infinite; display: inline-block;
`;
