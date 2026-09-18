// The deep-link controller touches localStorage and the platform bridge.
export function startInvitationCapture() {}
export function onInvitation() {
  return () => {};
}
export function resetInvitationCaptureForTests() {}
export type CapturedInvitation = { code: string; resolve: () => void };
