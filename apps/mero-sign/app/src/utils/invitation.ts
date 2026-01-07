/**
 * Invitation utility functions for handling invitation payloads
 */

const INVITATION_STORAGE_KEY = 'merodocs-invitation-payload';

/**
 * Save invitation payload to localStorage
 */
export function saveInvitationToStorage(invitationPayload: string): void {
  try {
    localStorage.setItem(INVITATION_STORAGE_KEY, invitationPayload);
  } catch (error) {
    console.error('Failed to save invitation to localStorage:', error);
  }
}

/**
 * Retrieve invitation payload from localStorage
 */
export function getInvitationFromStorage(): string | null {
  try {
    return localStorage.getItem(INVITATION_STORAGE_KEY);
  } catch (error) {
    console.error('Failed to retrieve invitation from localStorage:', error);
    return null;
  }
}

/**
 * Clear invitation payload from localStorage
 */
export function clearInvitationFromStorage(): void {
  try {
    localStorage.removeItem(INVITATION_STORAGE_KEY);
  } catch (error) {
    console.error('Failed to clear invitation from localStorage:', error);
  }
}

/**
 * Generate invitation URL with payload as query parameter
 */
export function generateInvitationUrl(invitationPayload: string): string {
  const currentHost = window.location.origin;
  const encodedPayload = encodeURIComponent(invitationPayload);
  return `${currentHost}/?invitation=${encodedPayload}`;
}

/**
 * Extract invitation payload from URL query parameters
 */
export function extractInvitationFromUrl(): string | null {
  try {
    const urlParams = new URLSearchParams(window.location.search);
    const invitation = urlParams.get('invitation');
    return invitation ? decodeURIComponent(invitation) : null;
  } catch (error) {
    console.error('Failed to extract invitation from URL:', error);
    return null;
  }
}

/**
 * Check if there's a pending invitation (either in URL or localStorage)
 */
export function hasPendingInvitation(): boolean {
  return !!(extractInvitationFromUrl() || getInvitationFromStorage());
}


