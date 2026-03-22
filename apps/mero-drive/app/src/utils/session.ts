const SESSION_TIMEOUT_KEY = 'sessionLastActivity';
const SESSION_TIMEOUT_MS = 3600000; // 1 hour

export function updateSessionActivity(): void {
  localStorage.setItem(SESSION_TIMEOUT_KEY, Date.now().toString());
}

export function isSessionExpired(): boolean {
  const stored = localStorage.getItem(SESSION_TIMEOUT_KEY);
  if (!stored) return false;
  const lastActivity = parseInt(stored, 10);
  if (isNaN(lastActivity)) return false;
  return Date.now() - lastActivity >= SESSION_TIMEOUT_MS;
}

export function clearSessionActivity(): void {
  localStorage.removeItem(SESSION_TIMEOUT_KEY);
}

export function clearStoredSession(): void {
  localStorage.removeItem('lastSession');
}
