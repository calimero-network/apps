import { styled } from "styled-components";
import { promptInstall, useCanInstall } from "../../pwa/installPrompt";

const Button = styled.button`
  border: none;
  background: transparent;
  color: var(--glass-ink-2);
  width: 36px;
  height: 36px;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  cursor: pointer;
  transition:
    color 0.2s ease,
    background-color 0.2s ease;
  &:hover {
    color: var(--glass-ink);
    background-color: color-mix(in srgb, var(--glass-ink) 10%, transparent);
  }
  &:focus-visible {
    outline: 2px solid var(--glass-accent);
    outline-offset: 2px;
  }
`;

const InstallIcon = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <rect x="2" y="3" width="20" height="14" rx="2" />
    <path d="M8 21h8M12 17v4M12 6v7M9 10l3 3 3-3" />
  </svg>
);

/** Top-bar button that installs Chat as an app; hidden unless the browser offers it. */
export default function InstallButton() {
  const canInstall = useCanInstall();
  if (!canInstall) return null;
  return (
    <Button
      type="button"
      onClick={() => void promptInstall()}
      aria-label="Install app"
      title="Install app"
      data-testid="install-app"
    >
      <InstallIcon />
    </Button>
  );
}
