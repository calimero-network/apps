import type { KeyboardEvent } from 'react';

// Up/Down walk focus through the elements matching `selector` inside the handler's element, stopping at both ends.
export function moveFocus(
  e: KeyboardEvent<HTMLElement>,
  selector: string,
): void {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  const targets = Array.from(
    e.currentTarget.querySelectorAll<HTMLElement>(selector),
  ).filter((el) => !el.hasAttribute('disabled'));
  const current = targets.indexOf(document.activeElement as HTMLElement);
  const step = e.key === 'ArrowDown' ? 1 : -1;
  const next =
    targets[Math.min(targets.length - 1, Math.max(0, current + step))];
  if (!next) return;
  e.preventDefault();
  next.focus();
}
