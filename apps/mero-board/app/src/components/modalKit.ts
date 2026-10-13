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
  background: rgba(6,7,9,0.6);
  animation: ${fadeIn} 0.15s ease both;
`;
export const Dialog = styled.div`
  position: relative; width: 100%; max-width: 420px;
  background: ${t.color.panel}; border: 1px solid ${t.color.borderStrong}; border-radius: ${t.radiusModal};
  padding: 28px 26px 24px; box-shadow: 0 20px 60px rgba(0,0,0,0.55);
  font-family: ${t.font.sans}; color: ${t.color.text};
  animation: ${pop} 0.18s ease both;
  h3 { font-size: 18px; font-weight: 600; letter-spacing: -0.02em; margin: 0 0 8px; }
  .sub { font-size: 13px; line-height: 1.55; color: ${t.color.text2}; margin: 0; }
`;
export const Close = styled.button`
  position: absolute; top: 14px; right: 14px; width: 30px; height: 30px;
  display: grid; place-items: center; font-size: 20px; line-height: 1;
  color: ${t.color.text3}; background: transparent; border: none; border-radius: 6px; cursor: pointer;
  &:hover { background: rgba(255,255,255,0.05); color: ${t.color.text}; }
`;
export const Field = styled.div`
  margin: 20px 0 4px;
  label { display: block; font-size: 12px; font-weight: 600; color: ${t.color.text2}; margin-bottom: 7px; }
  input {
    width: 100%; box-sizing: border-box;
    font-size: 13px; color: ${t.color.text}; background: ${t.color.raised};
    border: 1px solid ${t.color.border}; border-radius: ${t.radius}; padding: 10px 12px;
    outline: none; font-family: inherit;
    &::placeholder { color: ${t.color.text3}; }
    &:focus { border-color: ${t.color.accentBorder}; }
    &:disabled { opacity: 0.6; }
  }
`;
export const Actions = styled.div`display: flex; gap: 10px; justify-content: flex-end; margin-top: 18px;`;
const btn = `
  padding: 10px 18px; font-size: 13px; font-weight: 600; border-radius: ${t.radius}; cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
  &:disabled { opacity: 0.6; cursor: default; }
`;
export const SecondaryBtn = styled.button`
  ${btn}
  color: ${t.color.text}; background: ${t.color.raised}; border: 1px solid ${t.color.border};
  &:hover:not(:disabled) { background: ${t.color.raised2}; }
`;
export const PrimaryBtn = styled.button`
  ${btn}
  min-width: 120px; display: inline-flex; align-items: center; justify-content: center;
  color: ${t.color.onAccent}; background: ${t.color.accent}; border: 1px solid transparent;
  &:hover:not(:disabled) { background: #b6ff5e; }
`;
export const ErrorLine = styled.p`margin: 12px 0 0; font-size: 12.5px; color: ${t.color.urgent};`;
export const Spin = styled.span`
  width: 15px; height: 15px; border: 2px solid rgba(12,16,5,0.3); border-top-color: ${t.color.onAccent};
  border-radius: 50%; animation: ${spin} 0.6s linear infinite; display: inline-block;
`;
