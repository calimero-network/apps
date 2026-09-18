// Aliased over src/lib/vaults. Fixture data only — every shape here matches what
// the real module returns, so the screenshots document the real components.
import { VARIANT } from './fixtures';
import { ADMIN_CAPABILITIES, MEMBER_CAPABILITIES } from '../../src/lib/roles';

// Inlined, not re-exported: the alias in vite.config.ts matches `/lib/vaults`
// anywhere, including this file's own import of it, which rollup reports as a
// re-export that references itself.
export function displayName(
  candidates: readonly (string | null | undefined)[],
  id: string,
  fallbackPrefix: string,
): string {
  for (const candidate of candidates) {
    const trimmed = (candidate ?? '').trim();
    if (trimmed) return trimmed;
  }
  return `${fallbackPrefix} ${id.slice(0, 8)}…`;
}

const TEAMS = [
  // The personal vault arrives in the SAME listing as the teams — it is a
  // namespace like any other on the wire — and the screen is what separates
  // them. Note `memberCount: 1` on both this and "Side project": the marker is
  // what makes one private, not the headcount.
  {
    namespaceId: 'ns-p',
    name: 'Personal',
    memberCount: 1,
    vaultCount: 1,
    personal: true,
  },
  {
    namespaceId: 'ns-1',
    name: 'Acme Ltd',
    memberCount: 4,
    vaultCount: 3,
    personal: false,
  },
  {
    namespaceId: 'ns-2',
    name: 'Home',
    memberCount: 2,
    vaultCount: 1,
    personal: false,
  },
  {
    namespaceId: 'ns-3',
    name: 'Side project',
    memberCount: 1,
    vaultCount: 0,
    personal: false,
  },
  {
    namespaceId: 'ns-4',
    name: 'Ops on-call',
    memberCount: 7,
    vaultCount: 5,
    personal: false,
  },
];

const VAULTS = [
  {
    vaultId: 'sg-1',
    name: 'Bank logins',
    contextId: 'ctx-1',
    memberCount: 4,
    joined: true,
    identity: 'e'.repeat(64),
  },
  {
    vaultId: 'sg-2',
    name: 'Production keys',
    contextId: 'ctx-2',
    memberCount: 3,
    joined: false,
    identity: null,
  },
  {
    vaultId: 'sg-3',
    name: 'Shared subscriptions',
    contextId: null,
    memberCount: 2,
    joined: false,
    identity: null,
  },
];

const MEMBERS = [
  {
    accountId: 'a'.repeat(64),
    name: 'Ada Lovelace',
    role: 'admin' as const,
    rawRole: 'Owner',
    capabilities: ADMIN_CAPABILITIES,
    isSelf: true,
  },
  {
    accountId: 'b'.repeat(64),
    name: 'Priya',
    role: 'admin' as const,
    rawRole: 'Admin',
    capabilities: ADMIN_CAPABILITIES,
    isSelf: false,
  },
  {
    accountId: 'c'.repeat(64),
    name: 'Tom',
    role: 'member' as const,
    rawRole: 'Member',
    capabilities: MEMBER_CAPABILITIES,
    isSelf: false,
  },
];

// A role recorded but not yet projected — the row the panel exists to surface.
const MISMATCHED = [
  MEMBERS[0],
  {
    ...MEMBERS[1],
    name: 'Priya',
    role: 'admin' as const,
    capabilities: MEMBER_CAPABILITIES,
  },
  MEMBERS[2],
];

export async function listTeams() {
  if (VARIANT === 'error')
    throw new Error('The node refused the request (503).');
  if (VARIANT === 'empty') return [];
  // `noPersonal` is the state before anyone has made one — the screen has to
  // offer to create it, and that offer is a different shape from a card.
  return VARIANT === 'noPersonal' ? TEAMS.filter((t) => !t.personal) : TEAMS;
}

export async function listVaults() {
  return VARIANT === 'empty' ? [] : VAULTS;
}

export async function listTeamMembers() {
  return VARIANT === 'peopleMismatch' ? MISMATCHED : MEMBERS;
}

export async function createTeam() {
  return { namespaceId: 'ns-new' };
}
export async function createPersonalVault() {
  return { namespaceId: 'ns-p', vaultId: 'sg-p', contextId: 'ctx-p' };
}
export async function createVault() {
  return { vaultId: 'sg-new', contextId: 'ctx-new', memberPublicKey: 'k' };
}
export async function enterVaultContext() {
  return 'e'.repeat(64);
}
export async function mintTeamInvite() {
  return '3mJr7AoUCHxNqd6bVw2ZkPfT';
}
export async function mintVaultInvite() {
  return '3mJr7AoUCHxNqd6bVw2ZkPfT';
}
export async function setMemberRole() {
  return {
    role: 'admin' as const,
    capabilities: ADMIN_CAPABILITIES,
    missing: [],
    effective: true,
  };
}
export async function myCapabilities() {
  return ADMIN_CAPABILITIES;
}
export async function findVaultByContext() {
  return VARIANT === 'personal'
    ? {
        namespaceId: 'ns-p',
        vaultId: 'sg-p',
        teamName: 'Personal',
        vaultName: 'Personal',
        personal: true,
      }
    : {
        namespaceId: 'ns-1',
        vaultId: 'sg-1',
        teamName: 'Acme Ltd',
        vaultName: 'Bank logins',
        personal: false,
      };
}
export async function acceptInvite() {
  return {
    namespaceId: 'ns-1',
    vaultId: null,
    contextId: null,
  };
}
export async function redeemInvite() {
  return { kind: 'team' as const, namespaceId: 'ns-1' };
}
