import { describe, expect, it, vi } from 'vitest';
import { MemberNameDirectory } from '@calimero-apps/names';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { participantInitials, participantName } from './participants';

// ── People by name, not by account id ──────────────────────────────────────
//
// The People tab named every participant `a0a0a0a0…a0a0a0` with `A0` for an
// avatar, and its toasts said "a0a0a0a0…a0a0a0 removed." — even for someone
// who had named themselves for the workspace. The name lives on the namespace
// (member metadata, shared by every app on it); the roster now reads it.

const SANDI =
  '5926f2d2a4940fa2a62edd2cd7d833897c2c1596c697ea674dd0f49b89d11334';

describe('participant names', () => {
  it('names a participant from the workspace member listing', async () => {
    const names = new MemberNameDirectory();
    const admin = {
      listGroupMembers: vi.fn().mockResolvedValue({
        members: [{ identity: SANDI, role: 'Member', name: 'Sandi Fatic' }],
      }),
    };
    await names.load(admin, 'ws-1');
    const nameOf = (id: string) => names.peek('ws-1', id);

    expect(participantName(SANDI, nameOf)).toBe('Sandi Fatic');
    expect(participantInitials(SANDI, nameOf(SANDI))).toBe('SF');
    expect(admin.listGroupMembers).toHaveBeenCalledWith('ws-1');
  });

  it('falls back to a short id, never the full key', () => {
    expect(participantName(SANDI, () => undefined)).toBe('5926f2d2…d11334');
    expect(participantInitials(SANDI)).toBe('59');
  });
});

// A SOURCE test for the page, because this app's vitest runs in `node` with no
// testing-library (see `pages/app/AgreementPage.viewer.test.ts`).
const page = readFileSync(
  resolve(__dirname, '../pages/app/AgreementPage.tsx'),
  'utf8',
);

describe('the People tab', () => {
  it('reads names from the workspace (namespace), not a subgroup', () => {
    expect(page).toMatch(/useMemberNames\(admin, workspaceId\)/);
  });

  it('labels rows and toasts by name, not by id', () => {
    expect(page).not.toMatch(/\{shortId\(entry\.id\)\}/);
    expect(page).not.toMatch(/entry\.id\.slice\(0, 2\)/);
    expect(page).not.toMatch(/flash\(`\$\{shortId\(/);
    expect(page).toMatch(/\{personName\(entry\.id\)\}/);
  });

  it('lets you set the name others see', () => {
    expect(page).toMatch(/aria-label="Your name"/);
    expect(page).toMatch(
      /publishMemberName\(admin, workspaceId, selfAccountId, name\)/,
    );
  });
});
