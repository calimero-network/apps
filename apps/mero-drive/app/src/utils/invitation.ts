export interface GroupInvitationPayload {
  invitation: unknown;
  groupAlias?: string;
}

export function serializeGroupInvitationPayload(payload: GroupInvitationPayload): string {
  return btoa(JSON.stringify({
    invitation: payload.invitation,
    groupAlias: payload.groupAlias,
  }));
}

export function parseGroupInvitationPayload(encoded: string): GroupInvitationPayload {
  try {
    const decoded = atob(encoded);
    const parsed = JSON.parse(decoded);

    if (!parsed.invitation) {
      throw new Error('Missing invitation field in payload');
    }

    return {
      invitation: parsed.invitation,
      groupAlias: parsed.groupAlias,
    };
  } catch (err) {
    if (err instanceof Error && err.message.includes('Missing invitation')) {
      throw err;
    }
    throw new Error('Invalid invitation payload');
  }
}
